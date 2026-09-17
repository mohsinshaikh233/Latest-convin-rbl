import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { archiveSources, archiveSummary, cohortArchiveKey } from './archive.mjs';
import { need, env } from './config.mjs';
import { cohortsDir } from './paths.mjs';

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function dateForms(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return [];
  const [, y, mo, d] = m;
  const day = String(Number(d));
  const mon = MONTH_NAMES[Number(mo) - 1];
  return [
    iso,
    `${d}/${mo}/${y}`, `${day}/${Number(mo)}/${y}`,
    `${mo}/${d}/${y}`,
    `${day} ${mon}`, `${d} ${mon}`,
    `${mon} ${day}`,
  ];
}

const mentions = (subj, iso) => dateForms(iso).some((f) => subj.includes(f));

const OTHER_CAMPAIGN = { prex: 'bucket', bucket: 'prex' };

export function matchCohortScore(email, cohort) {
  const subj = (email.subject || '').toLowerCase();
  const namesThis = subj.includes(cohort.campaign);
  const other = OTHER_CAMPAIGN[cohort.campaign];
  if (other && subj.includes(other) && !namesThis) return 0;

  const looksLikeExport = subj.includes('ai call log') || subj.includes('call log') || subj.includes('export');
  if (!looksLikeExport && !namesThis) return 0;

  const s = mentions(subj, cohort.startDate);
  const e = mentions(subj, cohort.endDate);
  if (s && e) return 3;
  if (s) return 2;
  if (e) return 1;
  return 0;
}

export function matchesCohort(email, cohort) {
  return matchCohortScore(email, cohort) > 0;
}

async function findReportEmail(cohort, sinceMinutesAgo = 60, { hasTwin = false } = {}) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: env('IMAP_HOST'), port: Number(env('IMAP_PORT', 993)), secure: true,
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - sinceMinutesAgo * 60_000);
    const uids = await client.search({ since, from: 'convin' });

    const rejected = [];
    const candidates = [];
    for (const uid of (uids ?? []).reverse()) {
      const msg = await client.fetchOne(uid, { envelope: true, bodyStructure: true, source: false });
      const subject = msg?.envelope?.subject ?? '';
      const score = msg ? matchCohortScore({ subject }, cohort) : 0;
      if (score > 0) candidates.push({ uid, subject, score, bodyStructure: msg.bodyStructure, date: msg?.envelope?.date ?? null });
      else rejected.push({ uid, subject, date: msg?.envelope?.date ?? null });
    }

    if (candidates.length) {
      const best = Math.max(...candidates.map((c) => c.score));
      const top = candidates.filter((c) => c.score === best);

      if (top.length > 1 && hasTwin) {
        lock.release();
        await client.logout().catch(() => {});
        return { ambiguous: top.map(({ uid, subject, score }) => ({ uid, subject, score })), examined: rejected };
      }

      const win = top[0];

      return {
        uid: win.uid, client, lock, bodyStructure: win.bodyStructure, subject: win.subject, score: win.score,

        supersededCount: top.length > 1 ? top.length - 1 : 0,
        alsoConsidered: candidates.filter((c) => c !== win).map((c) => ({ subject: c.subject, score: c.score })),
      };
    }

    lock.release();
    await client.logout().catch(() => {});
    return { none: true, examined: rejected };
  } catch (e) {
    try { lock.release(); } catch {  }
    await client.logout().catch(() => {});
    throw e;
  }
}

function* parts(node, prefix = '') {
  if (!node) return;
  const num = node.part ?? prefix;
  if (Array.isArray(node.childNodes) && node.childNodes.length) {
    for (const child of node.childNodes) yield* parts(child, num);
    return;
  }
  yield { part: num || '1', node };
}

export function pickAttachment(bodyStructure) {
  const all = [...parts(bodyStructure)];
  const named = (n) => String(n.dispositionParameters?.filename ?? n.parameters?.name ?? '');
  const isCsv = (n) => /csv/i.test(n.type ?? '') || /\.csv$/i.test(named(n));
  const attached = all.filter(({ node }) => node.disposition === 'attachment' || named(node));

  const csv = all.find(({ node }) => isCsv(node));
  if (csv) return { ...csv, why: 'text/csv or a .csv filename' };

  const biggest = attached.sort((a, b) => (b.node.size ?? 0) - (a.node.size ?? 0))[0];
  if (biggest) return { ...biggest, why: 'largest attachment — no CSV part was declared' };
  return null;
}

async function downloadAttachment(client, uid, destPath, bodyStructure, log) {
  const chosen = pickAttachment(bodyStructure);
  if (!chosen) {
    const e = new Error('the matching email carries no attachment — only a body. Convin may be sending a download link rather than the file; the subject matched but there is nothing to collect.');
    e.noAttachment = true;
    throw e;
  }
  log?.(`  downloading part ${chosen.part} (${chosen.node.type ?? 'unknown type'}, ${chosen.node.size ?? '?'} bytes) — ${chosen.why}`);
  const { content } = await client.download(uid, chosen.part, { uid: true });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const chunks = [];
  for await (const chunk of content) chunks.push(chunk);
  fs.writeFileSync(destPath, Buffer.concat(chunks));
  return chosen;
}

function runRepair(fileOrDir) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', ['scripts/repair_calllog.mjs', fileOrDir, '--json'], { cwd: process.cwd() });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; process.stderr.write(d); });
    p.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    p.on('close', (code) => {
      const line = out.trim().split('\n').filter((l) => l.startsWith('{') || l.startsWith('[')).pop();
      resolve({ code, json: line ? JSON.parse(line) : null, stderr: err });
    });
  });
}

export async function run(ctx) {
  const { month, state, cohort: cohortArg } = ctx;
  const plan = state.stages?.['02']?.plan;
  if (!plan) return { code: 10, result: { ok: false, reason: 'stage 02 has not produced a plan yet', month } };
  const cohort = plan.cohorts.find((c) => `${c.campaign}|${c.startDate}` === cohortArg);
  if (!cohort) return { code: 2, result: { ok: false, reason: `cohort "${cohortArg}" not in this month's plan`, month } };

  const already = state.stages?.['04']?.collected?.[cohortArg];
  if (already?.repairedOk) {
    const onDisk = !!already.path && fs.existsSync(already.path) && fs.statSync(already.path).size > 0;
    if (onDisk) {
      ctx.log(`  ${cohortArg} already collected and repaired — skipping (idempotent)`);
      return { code: 0, result: { ok: true, month, cohort: cohortArg, alreadyDone: true, path: already.path, state: { collected: state.stages['04'].collected } } };
    }
    ctx.log(`  ${cohortArg} is marked collected but ${already.path ?? '(no path recorded)'} is missing or empty — collecting it again rather than trusting the ledger`);
  }

  if (ctx.dryRun) {
    ctx.log(`  DRY RUN — would search IMAP for ${cohortArg} and repair the attachment; touching nothing`);
    return {
      code: 0,
      result: {
        ok: true, month, cohort: cohortArg, dryRun: true, collected: false,
        wouldCollect: { cohort: cohortArg, campaign: cohort.campaign, dest: path.join(cohortsDir(month), `${cohortArg.replace('|', '__')}.csv`) },
        state: { dryRun: true },
      },
    };
  }

  const cached = state.stages?.['03']?.cohorts?.[cohortArg]?.cached === true;
  const destCached = path.join(cohortsDir(month), `${cohortArg.replace('|', '__')}.csv`);
  if (cached) {
    if (!fs.existsSync(destCached) || fs.statSync(destCached).size === 0) {
      return {
        code: 10,
        result: {
          ok: false, month, cohort: cohortArg,
          reason: `stage 03 recorded ${cohortArg} as served from cache, but there is no call log at ${destCached}. Something removed it between the two stages — re-run stage 03.`,
        },
      };
    }
    const { code: rc, json: rj, stderr: rerr } = await runRepair(destCached);
    if (rc !== 0) throw new Error(`repair_calllog.mjs failed on ${destCached} (exit ${rc}): ${rerr.slice(-1000)}`);
    const arch = await archiveSources(ctx, month, [{ path: destCached, key: cohortArchiveKey(cohortArg) }]);
    const coll = {
      ...(state.stages?.['04']?.collected ?? {}),
      [cohortArg]: { path: destCached, repairedOk: true, collectedAt: new Date().toISOString(), fromCache: true, repair: rj, archive: archiveSummary(arch) },
    };
    ctx.log(`  collected ${cohortArg} from cache (no mailbox touched) + repaired → ${destCached}`);
    return { code: 0, result: { ok: true, month, cohort: cohortArg, path: destCached, fromCache: true, repair: rj, archive: archiveSummary(arch), state: { collected: coll } } };
  }

  need('imap');

  const hasTwin = (plan.cohorts ?? []).some((c) => c.startDate === cohort.startDate
    && c.endDate === cohort.endDate && c.campaign !== cohort.campaign);
  const found = await findReportEmail(cohort, 60, { hasTwin });

  if (found?.ambiguous) {
    ctx.log(`  ${found.ambiguous.length} emails fit ${cohortArg} equally well — refusing to guess:`);
    for (const c of found.ambiguous) ctx.log(`      ${JSON.stringify(c.subject)}`);
    ctx.log('  Narrow matchCohortScore() once a real subject line has been seen, or forward the right one so it is the only match.');
    return {
      code: 10,
      result: {
        ok: false, month, cohort: cohortArg,
        reason: `${found.ambiguous.length} emails match cohort ${cohortArg} equally well and nothing in the subject distinguishes them. Their subjects are in candidateSubjects — collecting the wrong one is undetectable downstream, so this stops instead.`,
        candidateSubjects: found.ambiguous.map((c) => c.subject),
        examinedSubjects: (found.examined ?? []).map((e) => e.subject),
      },
    };
  }

  if (!found || found.none) {
    const examined = found?.examined ?? [];

    if (examined.length) {
      ctx.log(`  ${examined.length} email(s) from Convin in the last hour, none matching ${cohortArg}:`);
      for (const e of examined) ctx.log(`      ${JSON.stringify(e.subject)}${e.date ? `   (${new Date(e.date).toISOString()})` : ''}`);
      ctx.log('  If one of those IS this cohort\'s export, matchesCohort() needs widening — that is the only fix required.');
    } else {
      ctx.log('  no email from Convin at all in the last hour.');
    }
    return {
      code: 10,
      result: {
        ok: false, month, cohort: cohortArg,
        reason: examined.length
          ? `${examined.length} email(s) from Convin in the last hour but none matched cohort ${cohortArg}. Their subjects are listed in examinedSubjects — if one of them is this export, matchesCohort()'s pattern needs widening (it is inference until a real subject line has been seen).`
          : `no email from Convin found for cohort ${cohortArg} in the last hour — the export has probably not finished yet.`,
        examinedSubjects: examined.map((e) => e.subject),
      },
    };
  }

  const dest = path.join(cohortsDir(month), `${cohortArg.replace('|', '__')}.csv`);
  ctx.log(`  matched ${JSON.stringify(found.subject)} (fit ${found.score}/3)`);
  if (found.supersededCount) {
    ctx.log(`  ${found.supersededCount} earlier email(s) share this subject and no other cohort has this date range — taken as a re-export, newest wins`);
  }

  if (found.alsoConsidered?.length) {
    ctx.log(`  also considered: ${found.alsoConsidered.map((c) => `${JSON.stringify(c.subject)} (${c.score}/3)`).join(', ')}`);
  }
  try {
    await downloadAttachment(found.client, found.uid, dest, found.bodyStructure, ctx.log);
  } catch (e) {
    if (e.noAttachment) {
      return { code: 10, result: { ok: false, month, cohort: cohortArg, reason: `${e.message} Subject: ${JSON.stringify(found.subject)}`, subject: found.subject } };
    }
    throw e;
  } finally {
    try { found.lock.release(); } catch {  }
    await found.client.logout().catch(() => {});
  }

  const { code: repairCode, json: repairJson, stderr } = await runRepair(dest);
  if (repairCode !== 0) {
    throw new Error(`repair_calllog.mjs failed on ${dest} (exit ${repairCode}): ${stderr.slice(-1000)}`);
  }

  const archive = await archiveSources(ctx, month, [{ path: dest, key: cohortArchiveKey(cohortArg) }]);

  const collected = {
    ...(state.stages?.['04']?.collected ?? {}),
    [cohortArg]: { path: dest, repairedOk: true, collectedAt: new Date().toISOString(), repair: repairJson, archive: archiveSummary(archive) },
  };
  ctx.log(`  collected + repaired ${cohortArg} → ${dest}`);
  const result = { ok: true, month, cohort: cohortArg, path: dest, repair: repairJson, archive: archiveSummary(archive), state: { collected } };
  if (archive.failed.length) {
    result.warnings = [`the repaired call log for ${cohortArg} failed to archive — the cohort is collected, but this source is not durably stored`];
  }
  return { code: 0, result };
}
