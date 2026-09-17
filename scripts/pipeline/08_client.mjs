import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportsDir } from './paths.mjs';
import { findChrome, renderPdf } from './chrome.mjs';

const CAMPAIGN_LABEL = { prex: 'PDD', bucket: 'CYC' };

const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => Number(n ?? 0).toLocaleString('en-IN');

function monthTitle(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAME[m - 1]} ${y}`;
}

function prettyDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAME[m - 1]} ${y}`;
}

const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

function tokenLayer() {
  const p = path.join(process.cwd(), 'src', 'app', 'globals.css');
  if (!fs.existsSync(p)) return null;
  const css = fs.readFileSync(p, 'utf8');
  const blocks = css.match(/^:root\s*\{[\s\S]*?\n\}/gm) ?? [];
  return blocks.length ? blocks.join('\n\n') : null;
}

function documentHtml({ month, label, campaign, rows, totals, verify, generatedAt, tokens }) {
  const title = `${monthTitle(month)} — ${label} Portfolio`;
  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${tokens ?? '/* globals.css not found — falling back to literals below */'}
:root { --page: 12mm; }
@page { size: A4; margin: var(--page); }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--ti-00, #F7F6F4);
  color: var(--ti-90, #232120);
  font-family: var(--font-text, ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 10.5pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.sheet { padding: 4mm 2mm; }
header { border-bottom: 2px solid var(--au-50, #C08F4E); padding-bottom: 8px; margin-bottom: 18px; }
.eyebrow { font-size: 8pt; letter-spacing: .16em; text-transform: uppercase; color: var(--ti-50, #7C776E); }
h1 { font-size: 20pt; margin: 4px 0 2px; font-weight: 600; letter-spacing: -.01em; }
.sub { font-size: 9pt; color: var(--ti-50, #7C776E); }
.tiles { display: flex; gap: 10px; margin: 0 0 18px; }
.tile { flex: 1; border: 1px solid var(--ti-10, #E3E0DB); border-radius: 6px; padding: 10px 12px; background: #fff; }
.tile .k { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--ti-50, #7C776E); }
.tile .v { font-size: 17pt; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
thead th {
  text-align: left; font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ti-50, #7C776E); border-bottom: 1px solid var(--ti-20, #CFCBC4);
  padding: 0 8px 6px; font-weight: 600;
}
th.n, td.n { text-align: right; }
tbody td { padding: 7px 8px; border-bottom: 1px solid var(--ti-05, #EFEDEA); }
tbody tr:nth-child(even) { background: rgba(0,0,0,.015); }
tfoot td { padding: 9px 8px; border-top: 2px solid var(--ti-20, #CFCBC4); font-weight: 600; }
.book { font-weight: 500; }
.note { margin-top: 16px; font-size: 8.5pt; color: var(--ti-50, #7C776E); border-top: 1px solid var(--ti-10, #E3E0DB); padding-top: 10px; }
.note b { color: var(--ti-70, #4A4741); }
.verified { color: var(--au-70, #835C30); font-weight: 600; }
</style>
<div class="sheet">
  <header>
    <div class="eyebrow">RBL Bank × Convin · Recovery Intelligence</div>
    <h1>${esc(title)}</h1>
    <div class="sub">${rows.length} book${rows.length === 1 ? '' : 's'} · generated ${esc(generatedAt)}</div>
  </header>

  <div class="tiles">
    <div class="tile"><div class="k">Books</div><div class="v">${num(rows.length)}</div></div>
    <div class="tile"><div class="k">Accounts</div><div class="v">${num(totals.accounts)}</div></div>
    <div class="tile"><div class="k">AI attempts</div><div class="v">${num(totals.attempts)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Book</th><th>Loaded</th><th class="n">Days</th>
        <th class="n">Accounts</th><th class="n">AI attempts</th><th class="n">Attempts / account</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r) => `<tr>
        <td class="book">${esc(r.book)}</td>
        <td>${esc(prettyDate(r.loadDate))}</td>
        <td class="n">${r.days ?? '—'}</td>
        <td class="n">${num(r.accounts)}</td>
        <td class="n">${num(r.attempts)}</td>
        <td class="n">${r.accounts ? (r.attempts / r.accounts).toFixed(1) : '—'}</td>
      </tr>`).join('\n      ')}
    </tbody>
    <tfoot>
      <tr>
        <td>Total</td><td></td><td></td>
        <td class="n">${num(totals.accounts)}</td>
        <td class="n">${num(totals.attempts)}</td>
        <td class="n">${totals.accounts ? (totals.attempts / totals.accounts).toFixed(1) : '—'}</td>
      </tr>
    </tfoot>
  </table>

  <div class="note">
    <span class="verified">Verified.</span> Every figure above was checked against the source book
    file: account counts re-derived independently, every report confirmed complete, and each
    cohort's attempts checked against its own call log. The ${monthTitle(month)} run checked
    ${plural(verify.booksChecked ?? rows.length, 'book')} in total, across all portfolios, and found no discrepancies.
    ${totals.assumedUnresolved ? `<br>${plural(totals.assumedUnresolved, 'account')} absent from RBL's status file ${totals.assumedUnresolved === 1 ? 'was' : 'were'} carried as Unresolved.` : ''}
  </div>
</div>
`;
}

export async function run(ctx) {
  const { month, state } = ctx;

  const verify = state.stages?.['07']?.verify;
  if (!verify) {
    return { code: 10, result: { ok: false, month, reason: 'stage 07 has not verified this month yet — a client-facing artifact is only built on verified numbers' } };
  }
  if (!verify.ok) {
    return {
      code: 10,
      result: {
        ok: false, month,
        reason: 'stage 07 did NOT pass — refusing to build a client-facing portfolio on unverified numbers. ' +
          'This is the one artifact that reaches the client, and a wrong number on it is undetectable by whoever reads it.',
        verify,
      },
    };
  }

  const built = state.stages?.['06']?.built;
  const plan = state.stages?.['02']?.plan;
  if (!built?.reports?.length) return { code: 10, result: { ok: false, month, reason: 'stage 06 has no built reports in state' } };

  const meta = new Map((plan?.books ?? []).map((b) => [b.book, b]));
  const byCampaign = new Map();
  for (const r of built.reports) {
    const m = meta.get(r.book);
    const campaign = m?.campaign ?? 'prex';
    if (!byCampaign.has(campaign)) byCampaign.set(campaign, []);
    byCampaign.get(campaign).push({
      book: r.book,
      accounts: r.accounts ?? 0,
      attempts: r.attempts ?? 0,
      loadDate: m?.loadDate ?? null,
      days: m?.days ?? null,
      assumedUnresolved: (r.assumedUnresolved ?? []).length,
    });
  }
  if (!byCampaign.size) return { code: 10, result: { ok: false, month, reason: 'no books to report on' } };

  const chrome = findChrome();

  const outDir = ctx.dryRun
    ? fs.mkdtempSync(path.join(os.tmpdir(), `rbl-client-${month}-`))
    : path.join(reportsDir(month), 'client');
  fs.mkdirSync(outDir, { recursive: true });

  const tokens = tokenLayer();
  const generatedAt = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const documents = []; const failures = [];

  for (const [campaign, rowsRaw] of byCampaign) {
    const label = CAMPAIGN_LABEL[campaign] ?? campaign.toUpperCase();
    const rows = rowsRaw.sort((a, b) => a.book.localeCompare(b.book));
    const totals = rows.reduce((t, r) => ({
      accounts: t.accounts + r.accounts,
      attempts: t.attempts + r.attempts,
      assumedUnresolved: t.assumedUnresolved + r.assumedUnresolved,
    }), { accounts: 0, attempts: 0, assumedUnresolved: 0 });

    const base = `${monthTitle(month)} — ${label} Portfolio`;
    const htmlPath = path.join(outDir, `${base}.html`);
    const pdfPath = path.join(outDir, `${base}.pdf`);
    fs.writeFileSync(htmlPath, documentHtml({ month, label, campaign, rows, totals, verify, generatedAt, tokens }));

    const doc = { campaign, label, books: rows.length, accounts: totals.accounts, attempts: totals.attempts, html: htmlPath };
    if (!chrome) {
      failures.push({ ...doc, reason: 'no Chrome found — the HTML was written, the PDF was not' });
    } else {
      const res = await renderPdf(chrome, htmlPath, pdfPath, { log: ctx.log });
      if (res.ok) doc.pdf = pdfPath;
      else failures.push({ ...doc, reason: res.reason });
    }
    documents.push(doc);
    ctx.log(`  ${base} — ${rows.length} book(s), ${num(totals.accounts)} accounts, ${num(totals.attempts)} attempts${doc.pdf ? '' : ' (HTML only)'}`);
  }

  const ok = failures.length === 0;
  return {
    code: ok ? 0 : 1,
    result: {
      ok, month, outDir,
      dryRun: !!ctx.dryRun,
      documents,
      failures,
      tokensFrom: tokens ? 'src/app/globals.css' : 'fallback literals (globals.css not found)',
      ...(ok ? {} : { reason: `${failures.length} client document(s) did not render a PDF` }),
      state: ctx.dryRun ? { dryRun: true } : { client: { outDir, documents } },
    },
  };
}
