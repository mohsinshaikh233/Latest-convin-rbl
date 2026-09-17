import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const S3_PORT = 4698, CONVIN_PORT = 4699, IMAP_PORT = 15993;
const FIXTURE = path.join(REPO, '.pipeline-data', 'fixture-august');

let checks = 0, failures = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) { console.log(`  ✔ ${label}`); return true; }
  failures++;
  console.log(`  ✘ ${label}${detail ? `\n      ${detail}` : ''}`);
  return false;
};
const eq = (label, got, want) => ok(`${label}`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} · want ${JSON.stringify(want)}`);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { validateGroup, validateAll, redact, monthStates, GROUPS } =
  await import('../src/lib/console/credentials.mjs');
const { start: startImap, message, USER, PASS } = await import('./fakes/imap.mjs');

console.log('\n══ THE CREDENTIALS SCREEN ══');

console.log('\n── nothing that goes in comes out ──\n');
{
  const env = {
    S3_SECRET_ACCESS_KEY: 'sUp3r-s3cret-value-xyz',
    CONVIN_TOKEN: 'tok_live_abcdef123456',
    IMAP_PASSWORD: 'hunter2hunter2',
    DATABASE_URL: 'postgresql://user:pa55word@db.example.com:5432/rbl',
  };

  const hostile = `AccessDenied: the key sUp3r-s3cret-value-xyz cannot list; token tok_live_abcdef123456 rejected; pass hunter2hunter2`;
  const clean = redact(hostile, env);
  ok('a service error quoting the secret back is redacted',
    !clean.includes('sUp3r-s3cret-value-xyz') && !clean.includes('tok_live_abcdef123456') && !clean.includes('hunter2hunter2'), clean);
  ok('and it still says what happened', /AccessDenied/.test(clean), clean);
  ok('a Postgres URL loses its password, keeps its host',
    redact('could not connect to postgresql://user:pa55word@db.example.com:5432/rbl', env).includes('db.example.com')
    && !redact('could not connect to postgresql://user:pa55word@db.example.com:5432/rbl', env).includes('pa55word'),
    redact('could not connect to postgresql://user:pa55word@db.example.com:5432/rbl', env));

  const all = await validateAll({
    S3_ACCESS_KEY_ID: 'AKIAsecretkeyid00001', S3_SECRET_ACCESS_KEY: 'sUp3r-s3cret-value-xyz',
    S3_REGION: 'ap-south-1', S3_BUCKET: 'no-such-bucket-here', S3_PREFIX_BOOKS: 'books/',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    CONVIN_TENANT: 'rbl', CONVIN_TOKEN: 'tok_live_abcdef123456',
    CONVIN_CAMPAIGN_PREX: 'p', CONVIN_CAMPAIGN_BUCKET: 'b', CONVIN_API_BASE: 'http://127.0.0.1:1',
    IMAP_HOST: '127.0.0.1', IMAP_PORT: '1', IMAP_USER: 'ops@example.com', IMAP_PASSWORD: 'hunter2hunter2',
    DATABASE_URL: 'postgresql://user:pa55word@127.0.0.1:1/nope',
  });
  const blob = JSON.stringify(all);
  for (const [name, secret] of Object.entries({
    'the S3 secret': 'sUp3r-s3cret-value-xyz', 'the Convin token': 'tok_live_abcdef123456',
    'the IMAP password': 'hunter2hunter2', 'the DB password': 'pa55word',
  })) {
    ok(`${name} appears nowhere in a full failing result`, !blob.includes(secret));
  }
  ok('and every group still reported a failure', all.blocking.length === 4, JSON.stringify(all.blocking));
}

console.log('\n── an empty form is not a failure ──\n');
{
  const r = await validateGroup('s3', {});
  eq('nothing set reads as "unset", not "fail"', r.status, 'unset');
  ok('and it names every variable it wants', GROUPS.s3.every((k) => r.headline.includes(k) || k === 'S3_PREFIX_STATUS'),
    r.headline);
  ok('the remedy is an instruction, not a diagnosis', /Paste values/.test(r.remedy.join(' ')), JSON.stringify(r.remedy));
}

console.log('\n── S3 ──\n');
const s3 = spawn(process.execPath, [path.join(REPO, 'evals/fakes/s3.mjs'),
  '--port', String(S3_PORT), '--seed', FIXTURE, '--bucket', 'rbl-collections',
  '--dates', path.join(FIXTURE, 's3-dates.json')], { cwd: REPO });
s3.stderr.resume();
await new Promise((r) => setTimeout(r, 900));
{
  const base = {
    S3_ACCESS_KEY_ID: 'fixture', S3_SECRET_ACCESS_KEY: 'fixture', S3_REGION: 'ap-south-1',
    S3_BUCKET: 'rbl-collections', S3_PREFIX_BOOKS: 'books/', S3_PREFIX_STATUS: 'status/',
    S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
  };

  const stillUnset = await validateGroup('s3', { ...base, S3_PREFIX_STATUS: '' });
  eq('every variable in config.mjs\'s GROUPS.s3 is required by the checker too', stillUnset.status, 'unset');
  ok('and the one left out is named', /S3_PREFIX_STATUS/.test(stillUnset.headline), stillUnset.headline);
  const good = await validateGroup('s3', base);
  eq('a bucket with objects under the prefix passes', good.status, 'pass');
  ok('and it says which key it actually saw', /\.xlsx/.test(good.detail ?? ''), good.detail);
  ok('without claiming a count MaxKeys does not guarantee', !/\b\d+ objects?\b/.test(good.headline), good.headline);

  const wrongPrefix = await validateGroup('s3', { ...base, S3_PREFIX_BOOKS: 'bookz/' });
  eq('a prefix that matches nothing is a failure, not a pass', wrongPrefix.status, 'fail');
  ok('and it does NOT blame the credentials', /credentials work/i.test(wrongPrefix.headline), wrongPrefix.headline);
  ok('it names the prefix it actually tried', /bookz\//.test(JSON.stringify(wrongPrefix)), JSON.stringify(wrongPrefix.remedy));

  const noSlash = await validateGroup('s3', { ...base, S3_PREFIX_BOOKS: 'books' });
  eq('a prefix without its trailing slash still matches', noSlash.status, 'pass');

  const noBucket = await validateGroup('s3', { ...base, S3_BUCKET: 'not-a-bucket' });
  eq('a missing bucket fails', noBucket.status, 'fail');
  ok('naming the bucket and the region', /not-a-bucket/.test(noBucket.headline) && /ap-south-1/.test(noBucket.headline), noBucket.headline);
  ok('never the words "invalid credentials"', !/invalid credentials/i.test(JSON.stringify(noBucket)));
}

console.log('\n── Convin ──\n');
const convin = spawn(process.execPath, [path.join(REPO, 'evals/fakes/convin.mjs'),
  '--port', String(CONVIN_PORT), '--out', path.join(REPO, '.pipeline-data', 'fake-convin'),
  '--modes', 'read-only-token'], { cwd: REPO });
convin.stderr.resume();
await new Promise((r) => setTimeout(r, 900));
const convinEnv = {
  CONVIN_TENANT: 'rbl', CONVIN_TOKEN: 'tok-read-only', CONVIN_CAMPAIGN_PREX: 'prex-campaign',
  CONVIN_CAMPAIGN_BUCKET: 'bucket-campaign', CONVIN_API_BASE: `http://127.0.0.1:${CONVIN_PORT}`,
};
{
  const r = await validateGroup('convin', convinEnv);
  eq('a token that reads but cannot POST is NOT a pass', r.status, 'partial');
  ok('it is called read-scope in the headline', /READ-SCOPE/i.test(r.headline), r.headline);
  ok('never "connected"', !/\bconnected\b/i.test(r.headline), r.headline);
  ok('it says the read succeeded, so the token itself is valid',
    /read proves the token is valid|GET .* returned 200/i.test(r.detail ?? ''), r.detail);
  ok('and names the stage that would fail', /stage 03/i.test(r.detail ?? ''), r.detail);
  ok('the remedy asks for the right thing', /write scope/i.test(r.remedy.join(' ')), JSON.stringify(r.remedy));
  eq('the evidence records the scope', r.evidence?.scope, 'read');

  const st = await fetch(`http://127.0.0.1:${CONVIN_PORT}/__state`).then((x) => x.json());
  ok('and no export job was created by checking', (st.jobs ?? []).length === 0,
    `${(st.jobs ?? []).length} job(s): ${JSON.stringify(st.jobs).slice(0, 200)}`);
}
{
  const bad = await validateGroup('convin', { ...convinEnv, CONVIN_TOKEN: '' });
  eq('no credential of either kind reads as unset', bad.status, 'unset');

  const fallbackOnly = await validateGroup('convin', {
    ...convinEnv, CONVIN_TOKEN: '', CONVIN_EMAIL: 'ops@example.com', CONVIN_PASSWORD: 'x',
  });
  eq('login-only configuration is a GAP, not a pass', fallbackOnly.status, 'gap');
  ok('it says the selectors are TODO', /TODO/.test(fallbackOnly.detail ?? ''), fallbackOnly.detail);
  ok('and that the path has never been run', /never been run|has not been inspected/i.test(`${fallbackOnly.headline} ${fallbackOnly.detail}`),
    fallbackOnly.headline);
  eq('recorded as unverified', fallbackOnly.evidence?.selectorsVerified, false);
}

console.log('\n── the mailbox ──\n');
const imap = await startImap({ port: IMAP_PORT, messages: [message({ subject: 'hello', csv: 'a,b\n1,2\n' })] });
{
  const good = await validateGroup('imap', {
    IMAP_HOST: '127.0.0.1', IMAP_PORT: String(IMAP_PORT), IMAP_USER: USER, IMAP_PASSWORD: PASS,
  });
  eq('connect + open INBOX passes', good.status, 'pass');
  ok('and it reports what is in there', (good.evidence?.inboxMessages ?? -1) >= 1, JSON.stringify(good.evidence));

  const wrongPass = await validateGroup('imap', {
    IMAP_HOST: '127.0.0.1', IMAP_PORT: String(IMAP_PORT), IMAP_USER: USER, IMAP_PASSWORD: 'not-the-password',
  });
  eq('a rejected password fails', wrongPass.status, 'fail');
  ok('and the remedy mentions app passwords, not "try again"',
    /app password/i.test(wrongPass.remedy.join(' ')), JSON.stringify(wrongPass.remedy));
  ok('never "invalid credentials"', !/invalid credentials/i.test(JSON.stringify(wrongPass)));

  const noHost = await validateGroup('imap', {
    IMAP_HOST: 'no-such-host.invalid', IMAP_PORT: '993', IMAP_USER: USER, IMAP_PASSWORD: PASS,
  });
  eq('an unresolvable host fails', noHost.status, 'fail');
  ok('and says the password was never sent', /before any password was sent/i.test(noHost.remedy.join(' ')),
    JSON.stringify(noHost.remedy));
}
await imap.close();

console.log('\n── writing values in ──\n');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-env-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const mod = await import(`../src/lib/console/credentials.mjs?env=${Date.now()}`);
    fs.writeFileSync(path.join(tmp, '.env.local'),
      '# hand-written, keep\nS3_BUCKET=old-bucket\n\n# a comment that must survive\nDATABASE_URL=postgres://x\n');

    const w = mod.writeEnvLocal({ S3_BUCKET: 'new-bucket', IMAP_HOST: '  imap.example.com  ' });
    const text = fs.readFileSync(path.join(tmp, '.env.local'), 'utf8');

    ok('an existing key is replaced in place', /^S3_BUCKET=new-bucket$/m.test(text), text);
    ok('a new key is appended', /^IMAP_HOST=imap.example.com$/m.test(text), text);
    ok('comments survive', /# a comment that must survive/.test(text) && /# hand-written, keep/.test(text), text);
    ok('untouched keys survive', /^DATABASE_URL=postgres:\/\/x$/m.test(text), text);

    eq('a value with surrounding whitespace is trimmed', w.trimmed, ['IMAP_HOST']);
    ok('the response names what was written, never the values',
      JSON.stringify(w).includes('S3_BUCKET') && !JSON.stringify(w).includes('new-bucket'), JSON.stringify(w));

    const mode = fs.statSync(path.join(tmp, '.env.local')).mode & 0o777;
    eq('the file is left readable only by its owner', mode, 0o600);

    const st = mod.envStatus(['S3_BUCKET', 'IMAP_HOST', 'NEVER_SET_AT_ALL']);
    ok('envStatus reports names only', !JSON.stringify(st).includes('new-bucket'), JSON.stringify(st));
    ok('and partitions set from unset', st.set.includes('S3_BUCKET') && st.unset.includes('NEVER_SET_AT_ALL'), JSON.stringify(st));
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n── the state already on this machine ──\n');
{
  const months = monthStates();
  ok('every month with state on disk is listed', Array.isArray(months), typeof months);
  for (const m of months) {
    ok(`${m.month}: ${m.stages.length} stage(s), ${m.partial ? 'PARTIAL' : m.complete ? 'complete' : 'not started'}${m.lock ? ' · LOCKED' : ''}`,
      typeof m.partial === 'boolean' && typeof m.complete === 'boolean');
  }
  ok('a month is never both partial and complete', months.every((m) => !(m.partial && m.complete)));
  ok('stage keys are stages, not the lock record', months.every((m) => m.stages.every((k) => /^\d\d$/.test(k))),
    JSON.stringify(months.map((m) => m.stages)));
}

try { s3.kill(); } catch {  }
try { convin.kill(); } catch {  }

console.log(`\n${failures === 0 ? '✔' : '✘'} ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
