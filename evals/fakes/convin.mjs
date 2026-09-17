import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const PORT = Number(flag('port', 4599));
const OUT = flag('out', path.join(process.cwd(), '.pipeline-data', 'fake-convin'));

export const MODES = {
  'read-only-token': 'POST returns 401 — the token had read scope. Stage 03 must fall back, not die.',
  'tenant-lock': 'a second trigger while one job is queued is refused. Removing the button\'s disabled attribute did not get past this.',
  'wrong-params': '/report-downloads/active echoes a DIFFERENT date range than was asked for — the silent re-fire trap, seen twice.',
  'job-fails': 'the queued job ends in failure. Must retry, and must never be reported as "no calls".',
  'job-hangs': 'the job never leaves running. Has held the tenant lock for 100+ minutes.',
  'dup-columns': 'the export has 35 columns: Sense Disposition L1/L2/L3/Reason appear twice, the SECOND copy holding the real values.',
  'id-shapes': 'External IDs in all four observed shapes, including the 9-digit stray and the 7-digit truncated year.',
  'happy': 'everything works. Not the default, on purpose.',
};

const state = {
  modes: new Set((flag('modes', 'read-only-token,tenant-lock,dup-columns,id-shapes') || '').split(',').map((s) => s.trim()).filter(Boolean)),

  active: null,
  jobs: [],
  latencyMs: Number(flag('latency', 0)),
  requests: [],
};

const has = (m) => state.modes.has(m) && !state.modes.has('happy');
const log = (...a) => console.error('[fake-convin]', ...a);

function realShape(sampleCsv) {
  const fallback = ['To Phone Num', 'Call Attempt ID', 'Call Direction', 'From Phone Num', 'Campaign Name',
    'Campaign ID', 'Campaign Start Date', 'External ID', 'Lead ID', 'Lead Name', 'Lead Link',
    'Lead Creation Timestamp', 'Call Status', 'Telephony Disposition', 'Sense Disposition L1',
    'Sense Disposition L2', 'Sense Disposition L3', 'Sense Disposition Reason', 'Call Timestamp',
    'Call Answered Timestamp', 'Call End Timestamp', 'Call Duration (Seconds)', 'Call Pulse Unit',
    'Call Pulse Count', 'Attempt Number', 'Disconnect Reason Key', 'Call Disconnected By',
    'DND Identifier', 'Tool Executions', 'Tool Execution Success', 'Tool Execution Failures'];
  if (!sampleCsv || !fs.existsSync(sampleCsv)) return { header: fallback, source: 'the header asserted in evals/stress_calllog.mjs' };
  const fd = fs.openSync(sampleCsv, 'r');
  const buf = Buffer.alloc(8192);
  fs.readSync(fd, buf, 0, 8192, 0);
  fs.closeSync(fd);
  const line = buf.toString('utf8').split('\n')[0].replace(/\r$/, '');
  const header = line.split(',').map((h) => h.replace(/^"|"$/g, ''));
  return { header: header.length > 10 ? header : fallback, source: sampleCsv };
}

const SAMPLE = flag('sample', '/Users/rosh/Downloads/RBL/Call Logs/bucket__2026-08-13.csv');
const SHAPE = realShape(SAMPLE);

const L1 = ['Promise to pay', 'Refused', 'Wrong number', 'Call back later', ''];

let seed = 20260813 >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function externalId(account, loadDate, i) {
  const [y, m, d] = loadDate.split('-');
  const tok = `${d}${m}${y}`;
  if (!has('id-shapes')) return `${account}_${tok}`;
  switch (i % 20) {
    case 7: return `${account}_${tok[0]}${'0'}${tok.slice(1)}`;
    case 13: return `${account}_${tok.slice(0, 4)}${tok.slice(4, 7)}`;
    case 17: return `${account}${tok}`;
    default: return `${account}_${tok}`;
  }
}

export function generateExport({ accounts, loadDate, days, dupColumns }) {
  let header = [...SHAPE.header];

  const dupNames = ['Sense Disposition L1', 'Sense Disposition L2', 'Sense Disposition L3', 'Sense Disposition Reason'];
  if (dupColumns) {
    const at = header.indexOf('Sense Disposition Reason') + 1;
    header = [...header.slice(0, at), ...dupNames, ...header.slice(at)];
  }

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const lines = [header.map(csvCell).join(',')];
  let rows = 0;

  const norm = accounts.map((a) => (typeof a === 'string' ? { account: a, lastDay: null } : a));

  norm.forEach(({ account: acct, lastDay }, i) => {
    const window = lastDay ? days.filter((d) => d <= lastDay) : days;
    const usable = window.length ? window : days.slice(0, 1);
    const n = 1 + Math.floor(rnd() * 4);
    for (let a = 1; a <= n; a++) {
      const day = usable[Math.min(usable.length - 1, Math.floor(rnd() * usable.length))];
      const at = `${day} ${String(9 + Math.floor(rnd() * 9)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00`;
      const answered = rnd() < 0.42;
      const r = new Array(header.length).fill('');
      const set = (h, v) => { if (idx[h] !== undefined) r[idx[h]] = v; };
      set('To Phone Num', `+9150000${String(10000 + i).slice(-5)}`);
      set('Call Attempt ID', `att-${i}-${a}`);
      set('Call Direction', 'outbound');
      set('From Phone Num', '+915000000001');
      set('Campaign Name', 'Fake Campaign');
      set('Campaign ID', 'fake-campaign');
      set('Campaign Start Date', loadDate);
      set('External ID', externalId(acct, loadDate, i));
      set('Lead ID', `lead-${i}`);
      set('Lead Name', `Synthetic Placeholder ${i}`);
      set('Lead Link', 'https://example.invalid/lead');
      set('Lead Creation Timestamp', `${loadDate} 08:00:00`);
      set('Call Status', answered ? 'answered' : 'no_answer');
      set('Telephony Disposition', answered ? 'ANSWERED' : 'NO_ANSWER');
      set('Call Timestamp', at);
      set('Call Answered Timestamp', answered ? at : '');
      set('Call End Timestamp', answered ? at : '');
      set('Call Duration (Seconds)', answered ? String(20 + Math.floor(rnd() * 200)) : '');
      set('Call Pulse Unit', '60');
      set('Attempt Number', String(a));
      set('DND Identifier', 'N');

      if (dupColumns) {
        const second = header.lastIndexOf('Sense Disposition L1');
        r[second] = answered ? pick(L1) : '';
        r[header.lastIndexOf('Sense Disposition Reason')] = answered ? 'fake' : '';
      } else {
        set('Sense Disposition L1', answered ? pick(L1) : '');
      }
      lines.push(r.map(csvCell).join(','));
      rows++;
    }
  });
  return { csv: `${lines.join('\n')}\n`, rows, columns: header.length };
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};

function handleTrigger(req, res, tenant, campaignId, body) {
  const auth = req.headers.authorization ?? '';
  if (!/^Bearer\s+\S/.test(auth)) return json(res, 401, { detail: 'Authentication credentials were not provided.' });

  if (has('read-only-token')) {
    log('POST refused — token has read scope only');
    return json(res, 401, { detail: 'You do not have permission to perform this action.', scope: 'read' });
  }

  if (state.active && !['done', 'failed'].includes(state.active.status)) {
    if (has('tenant-lock')) {
      log(`POST refused — ${state.active.id} is already ${state.active.status} for this tenant`);
      return json(res, 429, { detail: 'A report download is already in progress for this tenant.', active: state.active.id });
    }
  }

  const id = `job-${state.jobs.length + 1}`;
  const asked = { start_date: body.start_date, end_date: body.end_date };

  const shift = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const scoped = has('wrong-params')
    ? { start_date: shift(asked.start_date, -7), end_date: shift(asked.end_date, -7) }
    : asked;

  const job = {
    id, tenant, campaignId,
    request_params: scoped,
    asked,
    status: 'queued',
    firedAt: Date.now(),
    readyAt: Date.now() + state.latencyMs,
  };
  state.jobs.push(job);
  state.active = job;
  state.requests.push({ at: new Date().toISOString(), campaignId, ...asked });
  log(`POST accepted → ${id} scoped ${scoped.start_date}→${scoped.end_date}${has('wrong-params') ? '  (WRONG on purpose)' : ''}`);
  return json(res, 200, { id, status: 'queued', request_params: scoped });
}

function advance() {
  const j = state.active;
  if (!j || ['done', 'failed'].includes(j.status)) return;
  if (has('job-hangs')) { j.status = 'running'; return; }
  if (Date.now() < j.readyAt) { j.status = 'running'; return; }
  j.status = has('job-fails') ? 'failed' : 'done';
  if (j.status === 'done') writeExportFor(j);
  log(`${j.id} → ${j.status}`);
}

function writeExportFor(job) {
  const byBoth = path.join(OUT, 'accounts', `${job.campaignId}__${job.request_params.start_date}.json`);
  const byDate = path.join(OUT, 'accounts', `${job.request_params.start_date}.json`);
  const accountsFile = fs.existsSync(byBoth) ? byBoth : byDate;
  if (!fs.existsSync(accountsFile)) { job.exportPath = null; return; }
  const { accounts, days } = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const { csv, rows, columns } = generateExport({
    accounts, loadDate: job.request_params.start_date, days, dupColumns: has('dup-columns'),
  });
  fs.mkdirSync(path.join(OUT, 'exports'), { recursive: true });
  const p = path.join(OUT, 'exports', `${job.campaignId}__${job.request_params.start_date}.csv`);
  fs.writeFileSync(p, csv);
  job.exportPath = p; job.rows = rows; job.columns = columns;
  log(`  wrote ${rows} rows × ${columns} cols → ${path.basename(p)}`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === '__mode') {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      try {
        const { modes, latencyMs } = JSON.parse(b || '{}');
        if (modes) state.modes = new Set(modes);
        if (latencyMs !== undefined) state.latencyMs = latencyMs;
        log('modes →', [...state.modes].join(',') || '(none)', `latency ${state.latencyMs}ms`);
        json(res, 200, { modes: [...state.modes], latencyMs: state.latencyMs });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    return;
  }
  if (parts[0] === '__state') { advance(); return json(res, 200, { active: state.active, jobs: state.jobs, requests: state.requests, modes: [...state.modes] }); }
  if (parts[0] === '__reset') { state.active = null; state.jobs = []; state.requests = []; return json(res, 200, { ok: true }); }

  if (parts[0] === 'v1' && parts[2] === 'report-downloads' && parts[3] === 'active') {
    advance();
    return json(res, 200, { active: state.active });
  }

  if (parts[0] === 'v1' && parts[2] === 'campaigns' && parts[4] === 'ai-call-logs' && req.method === 'POST') {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => { try { handleTrigger(req, res, parts[1], parts[3], JSON.parse(b || '{}')); } catch (e) { json(res, 400, { error: e.message }); } });
    return;
  }

  json(res, 404, { detail: 'Not found.', path: url.pathname });
});

if (process.argv[1] && process.argv[1].endsWith('convin.mjs')) {
  fs.mkdirSync(OUT, { recursive: true });
  server.listen(PORT, '127.0.0.1', () => {
    log(`listening on http://127.0.0.1:${PORT}`);
    log(`column shape from: ${SHAPE.source}`);
    log(`modes: ${[...state.modes].join(', ') || '(none — happy path)'}`);
  });
}

export { server, state };
