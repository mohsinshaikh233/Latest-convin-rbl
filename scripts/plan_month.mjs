#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readSheet } from '../src/lib/sheet.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? (argv[i + 1]?.startsWith('--') ? true : argv[i + 1]) : d;
};
const JSON_OUT = argv.includes('--json');

const PREX_DAYS = { 1: 5, 2: 4, 4: 3, 5: 2, 7: 4 };
const BUCKET_DAYS = 5;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

function parseDue(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

function classify(name, given = {}) {
  const m = name.match(/PDD\s*\+?\s*(\d+)/i);
  const n = m ? Number(m[1]) : null;
  const inferred = n == null ? 'bucket' : 'prex';
  const campaign = given.campaign ?? inferred;
  const days = given.days
    ?? (campaign === 'bucket' ? BUCKET_DAYS : (n == null ? null : PREX_DAYS[n] ?? null));
  return { campaign, n, days, campaignGiven: given.campaign != null, daysGiven: given.days != null, inferred };
}

function planBook({ file, loadDate, dir, campaign: givenCampaign, days: givenDays }) {
  const name = path.basename(file, path.extname(file));
  const { campaign, n, days, campaignGiven, daysGiven, inferred } =
    classify(name, { campaign: givenCampaign, days: givenDays });
  const S = new Date(`${loadDate}T00:00:00Z`);
  const out = { book: name, file, campaign, n, loadDate, days, campaignGiven, warnings: [] };

  if (!campaignGiven) {
    out.warnings.push(
      `campaign not specified — inferred "${inferred}" from the name. Set "campaign" on this ` +
      `entry to be certain: the wrong campaign pairs the book with the wrong status file and ` +
      `every number on the report will render correctly and be wrong.`,
    );
  }
  if (days == null) {
    out.warnings.push(
      `no day count for PDD+${n} — not in the verified table (${Object.keys(PREX_DAYS).map((k) => `+${k}`).join(', ')}). ` +
      `Set "days" on this entry.`,
    );
    return out;
  }
  if (!daysGiven && campaign === 'bucket' && n != null) {
    out.warnings.push(`Bucket book carrying PDD+${n} — using the Bucket default of ${BUCKET_DAYS} days. Confirm.`);
  }

  out.statusDates = Array.from({ length: days }, (_, i) => iso(addDays(S, i + 1)));
  out.dayFolders = out.statusDates.map((d, i) => ({ day: i + 1, date: d }));

  if (dir && n != null) {
    const full = path.join(dir, file);
    try {
      const rows = readSheet(fs.readFileSync(full), file);
      const hdr = (rows[0] || []).map((h) => String(h ?? '').toLowerCase());
      const di = hdr.findIndex((h) => h.includes('due') && h.includes('date'));
      if (di < 0) {
        out.warnings.push('no due-date column found — load date could not be cross-checked');
      } else {
        const raw = rows.slice(1).find((r) => r?.[di])?.[di];
        const due = parseDue(raw);
        if (!due) {
          out.warnings.push(`due date ${JSON.stringify(raw)} not parseable — load date not cross-checked`);
        } else {
          out.dueDate = iso(due);
          const expected = iso(addDays(due, n));
          if (expected !== loadDate) {
            out.warnings.push(
              `load date ${loadDate} != due ${iso(due)} + ${n} = ${expected}. ` +
              `Check this is the right file — July had two books both named "CYC 12 PDD+7" ` +
              `that differed only by load date (95 accounts vs 1,296).`,
            );
          }
        }
      }
    } catch (e) {
      out.warnings.push(`could not read ${file}: ${e.message}`);
    }
  } else if (n != null && !dir) {
    out.warnings.push('--books not given, so load dates were not cross-checked against due dates');
  }
  return out;
}

function main() {
  const manifestPath = flag('manifest');
  if (!manifestPath) {
    console.error('usage: node scripts/plan_month.mjs --manifest books.json [--books <dir>] [--json]');
    process.exit(1);
  }
  const dir = flag('books');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const books = manifest.map((m) => planBook({ ...m, dir }));

  const cohorts = new Map();
  for (const b of books) {
    if (!b.statusDates) continue;
    const key = `${b.campaign}|${b.loadDate}`;
    const end = b.statusDates[b.statusDates.length - 1];
    const c = cohorts.get(key) ?? { campaign: b.campaign, startDate: b.loadDate, endDate: end, books: [] };
    if (end > c.endDate) c.endDate = end;
    c.books.push(b.book);
    cohorts.set(key, c);
  }

  const statusNeeded = { prex: new Set(), bucket: new Set() };
  for (const b of books) for (const d of b.statusDates ?? []) statusNeeded[b.campaign].add(d);

  const plan = {
    books,
    cohorts: [...cohorts.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    statusFilesNeeded: {
      prex: [...statusNeeded.prex].sort(),
      bucket: [...statusNeeded.bucket].sort(),
    },
    totals: {
      books: books.length,
      dayFolders: books.reduce((s, b) => s + (b.days ?? 0), 0),
      exports: cohorts.size,
    },
    warnings: books.flatMap((b) => b.warnings.map((w) => `${b.book}: ${w}`)),
  };

  if (JSON_OUT) { console.log(JSON.stringify(plan)); return; }

  console.log(`\n  ${plan.totals.books} books · ${plan.totals.dayFolders} day-folders · ${plan.totals.exports} exports to pull\n`);
  for (const c of plan.cohorts) {
    console.log(`  ${c.campaign.padEnd(6)} cohort ${c.startDate} → ${c.endDate}   ${c.books.length} book(s): ${c.books.join(', ')}`);
  }
  console.log(`\n  status files — prex:   ${plan.statusFilesNeeded.prex.join(', ') || '(none)'}`);
  console.log(`  status files — bucket: ${plan.statusFilesNeeded.bucket.join(', ') || '(none)'}`);
  if (plan.warnings.length) {
    console.log(`\n  ⚠ ${plan.warnings.length} warning(s):`);
    for (const w of plan.warnings) console.log(`     - ${w}`);
  }
  console.log();
}

main();
