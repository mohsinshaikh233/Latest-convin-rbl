import fs from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const ENV_FILE = path.join(REPO, '.env.local');

export { GROUPS } from '../../../scripts/pipeline/config.mjs';

export const OPTIONAL = {
  s3: ['S3_PREFIX_ARCHIVE', 'S3_ENDPOINT'],
  convin: ['CONVIN_TOKEN', 'CONVIN_EMAIL', 'CONVIN_PASSWORD', 'CONVIN_API_BASE'],
  imap: ['IMAP_PORT'],
  db: [],
};

function secretsIn(env) {
  const out = Object.entries(env)
    .filter(([k, v]) => typeof v === 'string' && v.length >= 6 && /(KEY|SECRET|TOKEN|PASSWORD)/.test(k))
    .map(([, v]) => v);

  const url = env.DATABASE_URL;
  if (typeof url === 'string') {
    const m = url.match(/^postgres(?:ql)?:\/\/[^:@\s]+:([^@\s]+)@/i);
    if (m?.[1] && m[1].length >= 4) out.push(m[1]);
  }
  return out.sort((a, b) => b.length - a.length);
}

export function redact(text, env = process.env) {
  let s = String(text ?? '');
  for (const secret of secretsIn(env)) {
    if (secret && s.includes(secret)) s = s.split(secret).join('••••redacted••••');
  }

  s = s.replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)[^@\s]+@/gi, '$1••••@');
  return s;
}

const result = (group, status, headline, { detail = null, remedy = [], evidence = {} } = {}) =>
  ({ group, status, headline, detail, remedy, evidence, checkedAt: new Date().toISOString() });

const missing = (group, names) => result(group, 'unset',
  `${names.length} variable(s) not set: ${names.join(', ')}`,
  { remedy: [`Paste values for ${names.join(', ')} above. Nothing is checked until they are set.`] });

async function checkS3(env) {
  const want = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_BUCKET', 'S3_PREFIX_BOOKS', 'S3_PREFIX_STATUS'];
  const gone = want.filter((k) => !env[k]?.trim());
  if (gone.length) return missing('s3', gone);

  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
  });

  const prefix = env.S3_PREFIX_BOOKS;
  try {
    const out = await client.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, MaxKeys: 1 }));
    const n = out.KeyCount ?? out.Contents?.length ?? 0;
    if (n > 0) {
      return result('s3', 'pass', `Listed ${prefix} and it has objects in it`, {
        detail: `The first key it saw: ${out.Contents?.[0]?.Key ?? '(unnamed)'}`,
        evidence: { bucket: env.S3_BUCKET, prefix, region: env.S3_REGION, firstKey: out.Contents?.[0]?.Key ?? null },
      });
    }

    return result('s3', 'fail', `The credentials work, but ${prefix} is empty`, {
      detail: `LIST succeeded against ${env.S3_BUCKET} and returned zero keys under "${prefix}".`,
      remedy: [
        `Check S3_PREFIX_BOOKS for a typo — "${prefix}" is matched literally, so a wrong leading path returns nothing rather than erroring.`,
        'Confirm this month\'s books have actually been uploaded yet. An empty prefix and a bucket nobody has uploaded to look identical from here.',
        'A prefix without a trailing slash matches MORE than intended, not less: "books" also matches "books-archive/". That is the dangerous direction — too few objects fails loudly at stage 01, while too many silently mixes another month\'s files into this one and every number downstream is quietly wrong.',
      ],
      evidence: { bucket: env.S3_BUCKET, prefix, region: env.S3_REGION },
    });
  } catch (e) {
    const code = e?.name ?? e?.Code ?? '';
    const http = e?.$metadata?.httpStatusCode ?? null;
    const say = (headline, remedy) => result('s3', 'fail', headline, {
      detail: redact(`${code}${http ? ` (HTTP ${http})` : ''}: ${e.message}`, env),
      remedy, evidence: { bucket: env.S3_BUCKET, prefix, region: env.S3_REGION, code },
    });

    if (/InvalidAccessKeyId/i.test(code)) {
      return say('S3_ACCESS_KEY_ID is not a key this account recognises', [
        'Check you pasted the Access key ID (it begins AKIA or ASIA), not the secret.',
        'If the key was rotated, the old one stops working immediately — get the current pair.',
      ]);
    }
    if (/SignatureDoesNotMatch/i.test(code)) {
      return say('The key ID is recognised, but S3_SECRET_ACCESS_KEY does not match it', [
        'Re-copy the secret. A trailing space or newline is the usual cause and is invisible in most editors.',
        'The secret is only shown once at creation — if it was not saved, create a new key pair.',
      ]);
    }
    if (/NoSuchBucket/i.test(code)) {
      return say(`No bucket named "${env.S3_BUCKET}" in ${env.S3_REGION}`, [
        'Check S3_BUCKET for a typo.',
        `Check S3_REGION — a bucket in another region reports as missing rather than as elsewhere.`,
      ]);
    }
    if (/AccessDenied/i.test(code) || http === 403) {
      return say(`These credentials may not list "${prefix}" in ${env.S3_BUCKET}`, [
        `The key authenticated, so this is a permissions problem, not a wrong-password problem.`,
        `Ask for s3:ListBucket on ${env.S3_BUCKET} scoped to ${prefix}, and s3:GetObject on the objects under it.`,
      ]);
    }
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|NetworkingError|TimeoutError/i.test(`${code}${e.message}`)) {
      return say('Could not reach S3 at all', [
        'This is a network problem, not a credential problem — nothing was authenticated.',
        env.S3_ENDPOINT ? `S3_ENDPOINT is set to ${env.S3_ENDPOINT}; unset it to use the real AWS endpoint.` : 'Check the machine has outbound HTTPS.',
      ]);
    }
    return say(`S3 refused the request: ${code || 'unrecognised error'}`, [
      'The full error is above — it is the service\'s own words, not ours.',
    ]);
  }
}

const IMPOSSIBLE = { start_date: '1900-01-02', end_date: '1900-01-01' };

async function checkConvin(env) {
  const want = ['CONVIN_TENANT', 'CONVIN_CAMPAIGN_PREX', 'CONVIN_CAMPAIGN_BUCKET'];
  const gone = want.filter((k) => !env[k]?.trim());
  if (gone.length) return missing('convin', gone);

  const hasToken = !!env.CONVIN_TOKEN?.trim();
  const hasLogin = !!env.CONVIN_EMAIL?.trim() && !!env.CONVIN_PASSWORD?.trim();

  if (!hasToken && !hasLogin) {
    return result('convin', 'unset', 'No Convin credential of either kind', {
      remedy: [
        'Set CONVIN_TOKEN for the API path — this is the one that has been designed for.',
        'CONVIN_EMAIL + CONVIN_PASSWORD enable the browser fallback instead, whose selectors have never been run against Convin (see below).',
      ],
    });
  }

  if (!hasToken && hasLogin) {
    return result('convin', 'gap', 'Only the browser fallback is configured, and it has never been run', {
      detail: 'CONVIN_EMAIL and CONVIN_PASSWORD are set but CONVIN_TOKEN is not, so stage 03 would drive the Convin UI with Playwright. The selectors in 03_export.mjs are marked TODO: the page has not been inspected from this machine, so they are guesses.',
      remedy: [
        'Get a CONVIN_TOKEN. The API path is the one that has been built and tested.',
        'If the fallback must be used, someone has to open the export page once and confirm the selectors first. Until then this is untested code on the critical path.',
      ],
      evidence: { path: 'playwright-fallback', selectorsVerified: false },
    });
  }

  const base = `${env.CONVIN_API_BASE || 'https://api.convin.ai'}/v1/${env.CONVIN_TENANT}`;
  const auth = { Authorization: `Bearer ${env.CONVIN_TOKEN}` };
  const fallbackNote = hasLogin
    ? 'CONVIN_EMAIL + CONVIN_PASSWORD are also set, but the Playwright fallback\'s selectors are still TODO — it is not a tested second path.'
    : null;

  let read;
  try {
    read = await fetch(`${base}/report-downloads/active`, { headers: auth });
  } catch (e) {
    return result('convin', 'fail', 'Could not reach Convin', {
      detail: redact(e.message, env),
      remedy: [
        'This is a network problem — nothing was authenticated.',
        env.CONVIN_API_BASE ? `CONVIN_API_BASE is set to ${env.CONVIN_API_BASE}; unset it to use the real API.` : `Check the machine can reach ${base}.`,
      ],
    });
  }

  if (read.status === 401) {
    return result('convin', 'fail', 'CONVIN_TOKEN was rejected', {
      detail: `GET ${base}/report-downloads/active returned 401.`,
      remedy: [
        'The token is expired, revoked, or from a different tenant.',
        `Check CONVIN_TENANT — it is currently "${env.CONVIN_TENANT}", and a token issued for another tenant reads as unauthorised rather than as wrong-tenant.`,
        'Paste the token without the "Bearer " prefix; that is added for you.',
      ],
      evidence: { status: 401 },
    });
  }
  if (read.status === 404) {
    return result('convin', 'fail', `No such tenant path: /v1/${env.CONVIN_TENANT}`, {
      detail: `GET ${base}/report-downloads/active returned 404.`,
      remedy: [`Check CONVIN_TENANT. It is the slug in the Convin URL, e.g. "rblbank".`],
      evidence: { status: 404 },
    });
  }
  if (!read.ok) {
    return result('convin', 'fail', `Convin answered ${read.status} to a plain read`, {
      detail: redact(await read.text().catch(() => ''), env).slice(0, 400),
      remedy: ['The status above is Convin\'s own; nothing has been interpreted.'],
      evidence: { status: read.status },
    });
  }

  const campaign = env.CONVIN_CAMPAIGN_PREX;
  const url = `${base}/campaigns/${campaign}/ai-call-logs`;
  let probe;
  try {
    probe = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(IMPOSSIBLE) });
  } catch (e) {
    return result('convin', 'fail', 'The read worked but the trigger endpoint could not be reached', {
      detail: redact(e.message, env), remedy: [`Check ${url} is reachable from this machine.`],
    });
  }

  if (probe.status === 403 || probe.status === 401) {
    let says = '';
    try { says = JSON.stringify(await probe.json()).slice(0, 200); } catch {  }
    return result('convin', 'partial', 'This token is READ-SCOPE — it can poll, but it cannot start an export', {
      detail: `GET /report-downloads/active returned ${read.status}, but POST ${url} returned ${probe.status}. `
        + `The read proves the token is valid, so this is a permissions problem, not a wrong-token problem. `
        + `Stage 03 would fail on the first cohort.${says ? ` Convin said: ${redact(says, env)}` : ''}`,
      remedy: [
        'Ask for a token with write scope on the campaigns endpoint — the same permission the export button uses.',
        'A read-scope token is enough for stages 04-08 but not for 03, so the month would stop at the first export and every later stage would be waiting on a file that was never requested.',
        ...(fallbackNote ? [fallbackNote] : []),
      ],
      evidence: { read: read.status, post: probe.status, scope: 'read' },
    });
  }

  if (probe.ok) {
    return result('convin', 'partial', 'Convin ACCEPTED a deliberately impossible export request', {
      detail: `POST ${url} with ${JSON.stringify(IMPOSSIBLE)} returned ${probe.status} instead of rejecting it. The probe is designed never to create a job; this endpoint does not validate its input.`,
      remedy: [
        'Check the Convin dashboard for a stray export job for January 1900 and cancel it — the tenant allows only one at a time.',
        'Write access is proven. This is reported because an unvalidated endpoint means a typo in a real date range would also be accepted.',
      ],
      evidence: { read: read.status, post: probe.status, createdJob: 'possible' },
    });
  }

  return result('convin', 'pass', 'Token authenticates and is allowed to start an export', {
    detail: `GET /report-downloads/active → ${read.status}; POST ${url} with an impossible date range → ${probe.status}, which is the endpoint refusing the payload rather than the caller. No job was created.`,
    remedy: fallbackNote ? [fallbackNote] : [],
    evidence: { read: read.status, post: probe.status, scope: 'write', jobCreated: false },
  });
}

async function checkImap(env) {
  const want = ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD'];
  const gone = want.filter((k) => !env[k]?.trim());
  if (gone.length) return missing('imap', gone);

  const { ImapFlow } = await import('imapflow');
  const port = Number(env.IMAP_PORT || 993);
  const client = new ImapFlow({
    host: env.IMAP_HOST, port, secure: true,
    auth: { user: env.IMAP_USER, pass: env.IMAP_PASSWORD },
    logger: false,
  });
  try {
    await client.connect();

    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const exists = box?.exists ?? 0;
    return result('imap', 'pass', `Connected and opened INBOX (${exists} message${exists === 1 ? '' : 's'})`, {
      detail: `${env.IMAP_USER} on ${env.IMAP_HOST}:${port} over TLS.`,
      evidence: { host: env.IMAP_HOST, port, user: env.IMAP_USER, inboxMessages: exists },
    });
  } catch (e) {
    const msg = redact(e.message ?? String(e), env);
    const say = (headline, remedy) => result('imap', 'fail', headline, { detail: msg, remedy, evidence: { host: env.IMAP_HOST, port } });

    if (e?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHENTICATE/i.test(msg)) {
      return say('The mailbox rejected IMAP_USER / IMAP_PASSWORD', [
        'If this account has two-factor authentication, a normal password will not work — generate an app password and use that.',
        'Some providers require IMAP to be switched on per-account before any password works.',
        'IMAP_USER is usually the full address, not the local part.',
      ]);
    }
    if (/self.signed|certificate|CERT_|SSL|TLS/i.test(msg)) {
      return say(`TLS to ${env.IMAP_HOST}:${port} could not be established`, [
        `Port ${port} is being used with implicit TLS. If this server expects STARTTLS on 143, that is a different setup and this code does not do it.`,
        'A self-signed certificate will be refused, and should be.',
      ]);
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      return say(`No such host: ${env.IMAP_HOST}`, ['Check IMAP_HOST for a typo — this failed before any password was sent.']);
    }
    if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) {
      return say(`Nothing answered on ${env.IMAP_HOST}:${port}`, [
        `Check IMAP_PORT — 993 is implicit TLS, which is what this uses.`,
        'A firewall blocking outbound 993 looks exactly like this.',
      ]);
    }
    if (/NONEXISTENT|Mailbox doesn't exist|does not exist/i.test(msg)) {
      return say('Authenticated, but INBOX could not be opened', [
        'The account works; the mailbox does not. Check the account has an INBOX and that this user may select it.',
      ]);
    }
    return say('The mailbox could not be opened', ['The error above is the server\'s own.']);
  } finally {
    try { await client.logout(); } catch {  }
  }
}

async function checkDb(env) {
  if (!env.DATABASE_URL?.trim()) return missing('db', ['DATABASE_URL']);
  let client;
  try {
    const { default: pg } = await import('pg');
    client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
    const r = await client.query('SELECT 1 AS ok');
    const host = (() => { try { return new URL(env.DATABASE_URL).host; } catch { return 'the configured host'; } })();
    return result('db', 'pass', `Connected and queried ${host}`, {
      detail: `SELECT 1 returned ${r.rows?.[0]?.ok}.`,
      evidence: { host },
    });
  } catch (e) {
    const msg = redact(e.message ?? String(e), env);
    const say = (headline, remedy) => result('db', 'fail', headline, { detail: msg, remedy });
    if (/password authentication failed|no password supplied/i.test(msg)) {
      return say('Postgres rejected the password in DATABASE_URL', [
        'The password is part of the URL: postgresql://user:PASSWORD@host:port/db.',
        'A password containing @ : / or ? must be percent-encoded, or the URL parses into the wrong pieces.',
      ]);
    }
    if (/does not exist/i.test(msg) && /database/i.test(msg)) {
      return say('The database named in DATABASE_URL does not exist', ['Check the path segment after the host — that is the database name.']);
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return say('No such database host', ['Check the host in DATABASE_URL — this failed before any password was sent.']);
    if (/ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg)) {
      return say('Nothing answered on that host and port', [
        'On a hosted deployment this is usually the pooler port (6543) versus the direct port (5432).',
        'Locally, check Postgres is actually running.',
      ]);
    }
    if (/no pg_hba.conf entry|SSL/i.test(msg)) {
      return say('The server refused the connection\'s SSL mode', ['Most hosted Postgres requires ?sslmode=require on the end of the URL.']);
    }
    return say('Could not query the database', ['The error above is Postgres\'s own.']);
  } finally {
    try { await client?.end(); } catch {  }
  }
}

const CHECKS = { s3: checkS3, convin: checkConvin, imap: checkImap, db: checkDb };

export const GROUP_LABELS = {
  s3: 'S3 — where the books and status files come from',
  convin: 'Convin — where the call logs are exported from',
  imap: 'Mailbox — where the export notification arrives',
  db: 'Postgres — where the day tables are built',
};

export async function validateGroup(name, env = process.env) {
  const fn = CHECKS[name];
  if (!fn) return result(name, 'fail', `No such credential group: ${name}`);
  try {
    return await fn(env);
  } catch (e) {
    return result(name, 'fail', 'The check itself failed', {
      detail: redact(e?.stack ?? e?.message ?? String(e), env).split('\n').slice(0, 3).join(' '),
      remedy: ['This is a bug in the checker, not necessarily in the credential.'],
    });
  }
}

export async function validateAll(env = process.env, groups = Object.keys(CHECKS)) {
  const results = await Promise.all(groups.map((g) => validateGroup(g, env)));
  const by = Object.fromEntries(results.map((r) => [r.group, r]));
  return {
    checkedAt: new Date().toISOString(),
    groups: by,

    ready: results.every((r) => r.status === 'pass'),
    blocking: results.filter((r) => r.status !== 'pass').map((r) => r.group),
  };
}

function parseEnvFile(text) {
  const out = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out.set(key, val);
  }
  return out;
}

export function envStatus(allKeys) {
  const onDisk = fs.existsSync(ENV_FILE) ? parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8')) : new Map();
  return {
    exists: fs.existsSync(ENV_FILE),
    path: path.relative(REPO, ENV_FILE),
    set: allKeys.filter((k) => (onDisk.get(k) ?? process.env[k] ?? '').trim() !== ''),
    unset: allKeys.filter((k) => (onDisk.get(k) ?? process.env[k] ?? '').trim() === ''),

    processOnly: allKeys.filter((k) => !onDisk.has(k) && (process.env[k] ?? '').trim() !== ''),
  };
}

const QUOTE_NEEDED = /[\s#'"$`\\]/;
const serialise = (k, v) => `${k}=${QUOTE_NEEDED.test(v) ? JSON.stringify(v) : v}`;

export function writeEnvLocal(updates) {
  const names = Object.keys(updates ?? {});
  if (!names.length) return { written: [], trimmed: [], created: false };

  const existed = fs.existsSync(ENV_FILE);
  const lines = existed ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const trimmed = [];
  const clean = {};
  for (const [k, raw] of Object.entries(updates)) {
    const v = String(raw ?? '');
    const t = v.trim();
    if (t !== v) trimmed.push(k);
    clean[k] = t;
  }

  const done = new Set();
  const next = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
    if (!m || !(m[1] in clean)) return line;
    done.add(m[1]);
    return serialise(m[1], clean[m[1]]);
  });

  const added = names.filter((k) => !done.has(k));
  if (added.length) {
    if (next.length && next[next.length - 1].trim() !== '') next.push('');
    next.push(`# added by the console credentials screen, ${new Date().toISOString()}`);
    for (const k of added) next.push(serialise(k, clean[k]));
  }

  fs.writeFileSync(ENV_FILE, `${next.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  try { fs.chmodSync(ENV_FILE, 0o600); } catch {  }

  for (const [k, v] of Object.entries(clean)) process.env[k] = v;

  return { written: names, trimmed, created: !existed, path: path.relative(REPO, ENV_FILE) };
}

const STATE_DIR = path.join(REPO, 'state');

export function monthStates() {
  if (!fs.existsSync(STATE_DIR)) return [];
  const months = fs.readdirSync(STATE_DIR)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 7))
    .sort()
    .reverse();

  return months.map((month) => {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${month}.json`), 'utf8')); } catch {  }
    const stages = state?.stages ?? {};

    const done = Object.keys(stages).filter((k) => /^\d\d$/.test(k)).sort();

    let lock = null;
    const lockFile = path.join(STATE_DIR, `${month}.lock.json`);
    if (fs.existsSync(lockFile)) {
      try {
        const l = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        const ageH = (Date.now() - new Date(l.heartbeatAt ?? l.acquiredAt).getTime()) / 3_600_000;
        lock = {
          runId: l.runId ?? null, host: l.host ?? null, pid: l.pid ?? null,
          acquiredAt: l.acquiredAt ?? null,
          ageHours: Math.round(ageH * 100) / 100,

          likelyStale: ageH >= 2,
        };
      } catch { lock = { corrupt: true }; }
    }

    const reachedEnd = done.includes('07');
    return {
      month,
      stages: done,
      lastStage: done.length ? done[done.length - 1] : null,
      booksAssembled: stages['05']?.assembled?.books?.length ?? null,
      reportsBuilt: stages['06']?.built?.built ?? null,
      verified: stages['07']?.verify?.ok ?? null,
      partial: done.length > 0 && !reachedEnd,
      complete: reachedEnd && stages['07']?.verify?.ok === true,
      lock,
    };
  });
}
