import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import XLSX from 'xlsx';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p));

const SEED = expand(flag('seed', '~/Downloads/RBL'));
const OUT = expand(flag('out', '.pipeline-data/fixture-august'));
const CONVIN_OUT = expand(flag('convin-out', '.pipeline-data/fake-convin'));
const YEAR = 2026, MONTH = 8;

const PREX_DAYS = { 1: 5, 2: 4, 4: 3, 5: 2, 7: 4 };
const BUCKET_DAYS = 5;

const log = (...a) => console.error('[fixture]', ...a);
const iso = (d) => `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function rngFrom(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h |= 0; h ^= h >>> 17; h ^= h << 5; h |= 0; return ((h >>> 0) % 1e6) / 1e6; };
}

const BOOK_DIR = ['Calling File', 'books'].map((d) => path.join(SEED, d)).find((d) => fs.existsSync(d));
const STATUS_DIR = ['Status Files', 'status'].map((d) => path.join(SEED, d)).find((d) => fs.existsSync(d));
if (!BOOK_DIR || !STATUS_DIR) { console.error(`[fixture] no books/status under ${SEED}`); process.exit(1); }

const bookFiles = fs.readdirSync(BOOK_DIR).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$') && !f.startsWith('.')).sort();

const books = bookFiles.map((file) => {
  const m = file.match(/PDD\s*\+?\s*(\d+)/i);
  const n = m ? Number(m[1]) : null;
  const campaign = n == null ? 'bucket' : 'prex';
  const due = Number(file.match(/(\d+)/)[1]);
  const loadDay = due + (n ?? 0);
  const days = campaign === 'bucket' ? BUCKET_DAYS : PREX_DAYS[n];
  if (days == null) { console.error(`[fixture] no day count for PDD+${n} in ${file}`); process.exit(1); }
  return { file, name: path.basename(file, path.extname(file)), campaign, n, due, loadDate: iso(loadDay), loadDay, days };
});

log(`reading accounts from ${books.length} books…`);
const universe = { prex: new Set(), bucket: new Set() };
for (const b of books) {
  const wb = XLSX.readFile(path.join(BOOK_DIR, b.file), { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const header = rows[0].map((h) => String(h ?? '').trim());
  const ai = header.findIndex((h) => /^account\s*no/i.test(h));
  if (ai < 0) { console.error(`[fixture] no account column in ${b.file}: ${header.slice(0, 4).join(' | ')}`); process.exit(1); }
  b.accounts = [];
  for (let r = 1; r < rows.length; r++) {
    const v = String(rows[r][ai] ?? '').trim();
    if (!v) continue;
    b.accounts.push(v);
    universe[b.campaign].add(v);
  }
  log(`  ${b.file.padEnd(28)} ${String(b.accounts.length).padStart(5)} accounts · ${b.campaign} · S=${b.loadDate} · ${b.days}d`);
}

const cohortMap = new Map();
for (const b of books) {
  const key = `${b.campaign}|${b.loadDate}`;
  const endDay = b.loadDay + b.days;
  const c = cohortMap.get(key) ?? { campaign: b.campaign, startDate: b.loadDate, endDate: iso(endDay), books: [], accounts: new Map(), days: [] };
  if (iso(endDay) > c.endDate) c.endDate = iso(endDay);
  c.books.push(b.name);

  const last = iso(endDay);
  for (const a of b.accounts) {
    const prev = c.accounts.get(a);
    if (prev === undefined || last > prev) c.accounts.set(a, last);
  }
  cohortMap.set(key, c);
}
const cohorts = [...cohortMap.values()].sort((a, b) => (a.startDate + a.campaign).localeCompare(b.startDate + b.campaign));
for (const c of cohorts) {
  const sd = Number(c.startDate.slice(-2)), ed = Number(c.endDate.slice(-2));
  for (let d = sd; d <= ed; d++) c.days.push(iso(d));
}

const needed = { prex: new Set(), bucket: new Set() };
for (const b of books) for (let i = 1; i <= b.days; i++) needed[b.campaign].add(b.loadDay + i);

const realStatus = { prex: new Map(), bucket: new Map() };
for (const f of fs.readdirSync(STATUS_DIR)) {
  if (!/\.xlsx?$/i.test(f) || f.startsWith('~$') || f.startsWith('.')) continue;
  const m = f.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+Aug/i);
  if (!m) { log(`  ! status file with no readable date, skipped: ${f}`); continue; }
  const day = Number(m[1]);
  const camp = /prex/i.test(f) ? 'prex' : /bucket/i.test(f) ? 'bucket' : null;
  if (!camp) { log(`  ! status file with no readable campaign, skipped: ${f}`); continue; }
  if (!realStatus[camp].has(day)) realStatus[camp].set(day, f);
}

const RATES = {
  prex:   [['Resolved', 0.774], ['Unresolved', 1]],
  bucket: [['Unresolved', 0.893], ['Normalisation', 0.956], ['STAB', 0.996], ['RB', 1]],
};
const pickOutcome = (camp, u) => (RATES[camp].find(([, ceil]) => u <= ceil) ?? RATES[camp].at(-1))[0];

const fate = { prex: new Map(), bucket: new Map() };
const firstLoad = { prex: new Map(), bucket: new Map() };
for (const b of books) for (const a of b.accounts) {
  const cur = firstLoad[b.campaign].get(a);
  if (cur === undefined || b.loadDay < cur) firstLoad[b.campaign].set(a, b.loadDay);
}
for (const camp of ['prex', 'bucket']) {
  for (const a of universe[camp]) {
    const r = rngFrom(`${camp}:${a}`);
    const settleOffset = 1 + Math.floor(r() * 5);
    const outcome = pickOutcome(camp, r());
    const open = camp === 'prex' ? 'Unresolved' : 'Unresolved';
    fate[camp].set(a, { settleDay: firstLoad[camp].get(a) + settleOffset, outcome, open });
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'books'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'status'), { recursive: true });

const s3Dates = {};
const loadDates = {};
for (const b of books) {
  fs.symlinkSync(path.join(BOOK_DIR, b.file), path.join(OUT, 'books', b.file));
  loadDates[b.file] = b.loadDate;
  s3Dates[`books/${b.file}`] = `${b.loadDate}T04:30:00.000Z`;
}

let copied = 0, made = 0;
for (const camp of ['prex', 'bucket']) {
  const label = camp === 'prex' ? 'Prex' : 'Bucket';
  for (const day of [...needed[camp]].sort((a, b) => a - b)) {
    const real = realStatus[camp].get(day);
    const outName = real ?? `${label} Status ${day} Aug_26.xlsx`;
    const dest = path.join(OUT, 'status', outName);
    if (real) {
      fs.symlinkSync(path.join(STATUS_DIR, real), dest);
      copied++;
    } else {
      const aoa = [['account_no', 'status']];
      for (const a of universe[camp]) {
        const f = fate[camp].get(a);
        aoa.push([a, day >= f.settleDay ? f.outcome : f.open]);
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
      XLSX.writeFile(wb, dest);
      made++;
      log(`  SYNTHESISED ${outName}  (${aoa.length - 1} accounts)`);
    }
    s3Dates[`status/${outName}`] = `${iso(day)}T22:00:00.000Z`;
    loadDates[outName] = iso(day);
  }
}

fs.writeFileSync(path.join(OUT, 'loaddates.json'), `${JSON.stringify(loadDates, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, 's3-dates.json'), `${JSON.stringify(s3Dates, null, 2)}\n`);

fs.mkdirSync(path.join(CONVIN_OUT, 'accounts'), { recursive: true });
const campaignIdOf = (c) => (c === 'prex' ? process.env.CONVIN_CAMPAIGN_PREX ?? 'prex-campaign' : process.env.CONVIN_CAMPAIGN_BUCKET ?? 'bucket-campaign');
for (const c of cohorts) {
  const body = {
    accounts: [...c.accounts.entries()].map(([account, lastDay]) => ({ account, lastDay })),
    days: c.days, campaign: c.campaign, startDate: c.startDate, endDate: c.endDate,
  };
  fs.writeFileSync(path.join(CONVIN_OUT, 'accounts', `${campaignIdOf(c.campaign)}__${c.startDate}.json`), JSON.stringify(body));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  synthetic: {
    statusFiles: made,
    note: 'Status files for dates the real folder never held, plus every call-log row, are generated. Load dates are derived from book names. No figure from this fixture describes RBL\'s real August.',
  },
  real: { books: books.length, statusFiles: copied, seed: SEED },
  totals: { books: books.length, cohorts: cohorts.length, accounts: books.reduce((s, b) => s + b.accounts.length, 0) },
  cohorts: cohorts.map((c) => ({ campaign: c.campaign, startDate: c.startDate, endDate: c.endDate, books: c.books, accounts: c.accounts.size })),
  books: books.map(({ name, file, campaign, loadDate, days, n }) => ({ name, file, campaign, loadDate, days, pdd: n, accounts: undefined })),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

log('');
log(`books      ${books.length} (real, symlinked)`);
log(`cohorts    ${cohorts.length}  — prex ${cohorts.filter((c) => c.campaign === 'prex').length} · bucket ${cohorts.filter((c) => c.campaign === 'bucket').length}`);
log(`accounts   ${manifest.totals.accounts} across the books · ${universe.prex.size} distinct PreX · ${universe.bucket.size} distinct Bucket`);
log(`status     ${copied} real · ${made} SYNTHESISED`);
log(`out        ${OUT}`);
console.log(JSON.stringify({ ok: true, ...manifest.totals, syntheticStatusFiles: made, realStatusFiles: copied, out: OUT }));
