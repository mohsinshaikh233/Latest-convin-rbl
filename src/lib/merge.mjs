import { getField, normalizeMap, missingCritical, ALIASES, accountKey, isCorruptAccount } from './normalize.mjs';

export function toObjects(parsed) {
  if (!parsed || !parsed.length) return [];
  const header = parsed[0].map((h) => String(h ?? '').trim());
  const out = [];
  for (let i = 1; i < parsed.length; i++) {
    const rec = parsed[i];
    if (!rec || rec.length < 2) continue;
    const o = {};
    for (let c = 0; c < header.length; c++) {
      const k = header[c];
      if (!k) continue;
      if (o[k] === undefined || String(o[k]).trim() === '') o[k] = rec[c] ?? '';
    }
    out.push(o);
  }
  return out;
}

export { isCorruptAccount };

const keys = (v) => {
  const s = String(v ?? '').trim();
  if (!s || isCorruptAccount(s)) return [];
  const stripped = s.replace(/^0+/, '');
  return stripped && stripped !== s ? [s, stripped] : [s];
};

function indexByAccount(objs, mapping) {
  const map = new Map();
  let recovered = 0, corrupt = 0;
  const via = new Set();
  for (const o of objs) {
    const a = accountKey(o, mapping);
    if (a.recovered) { recovered++; if (a.from) via.add(a.from); }
    if (a.corrupt) corrupt++;
    for (const k of keys(a.key)) if (!map.has(k)) map.set(k, o);
  }
  map._recovered = recovered;
  map._corrupt = corrupt;
  map._via = [...via];
  return map;
}

export function buildCanonicalRows(primaryParsed, extraParsedList = [], mapping = null, extraNames = []) {
  const primary = toObjects(primaryParsed);
  if (!primary.length) throw new Error('The status sheet has no data rows.');

  const sheets = (extraParsedList || []).filter(Boolean);
  const indexes = sheets.map((p) => indexByAccount(toObjects(p), mapping));
  const sheetName = (i) => extraNames[i] || `additional sheet ${i + 1}`;

  let matched = 0;
  let enriched = 0;
  let corrupted = 0;
  let unmatched = 0;

  const hits = new Array(indexes.length).fill(0);
  const rows = [];

  for (const base of primary) {
    const acct = getField(base, 'account_no', mapping);
    const rec = { ...base };
    let didMatch = false;

    if (isCorruptAccount(acct)) {
      corrupted++;
    } else {
      for (let s = 0; s < indexes.length; s++) {
        const idx = indexes[s];
        let hit = null;
        for (const k of keys(acct)) { if (idx.has(k)) { hit = idx.get(k); break; } }
        if (!hit) continue;
        didMatch = true;
        hits[s]++;

        for (const [k, v] of Object.entries(hit)) {
          if (rec[k] === undefined || String(rec[k]).trim() === '') {
            if (v !== undefined && String(v).trim() !== '') { rec[k] = v; enriched++; }
          }
        }
      }
    }
    if (didMatch) matched++;
    else if (indexes.length && !isCorruptAccount(acct)) unmatched++;
    rows.push(rec);
  }

  const usable = primary.length - corrupted;
  for (let s = 0; s < indexes.length; s++) {
    if (!usable) break;
    if (hits[s] !== 0) continue;
    const sampleTheirs = [...indexes[s].keys()][0] ?? '(none)';
    const sampleOurs = String(getField(primary[0] || {}, 'account_no', mapping) || '?');
    throw new Error(
      `"${sheetName(s)}" did not match a single account, so none of its columns were used. `
      + `The primary sheet numbers accounts like "${sampleOurs}", that file like "${sampleTheirs}". `
      + `Either it is the wrong export, or the Account No columns are in different formats. `
      + `Uploading it as-is would produce a dashboard with no data behind it.`,
    );
  }

  const emptyRow = (r) => Object.values(r).every((v) => String(v ?? '').trim() === '');
  const real = rows.filter((r) => !emptyRow(r));
  const blankJunk = rows.length - real.length;

  const identified = [];
  let noAccount = 0;
  for (const r of real) {
    if (String(getField(r, 'account_no', mapping) || '').trim() === '') noAccount++;
    else identified.push(r);
  }

  const missingCount = {};
  const examples = {};
  for (const r of identified) {
    for (const k of missingCritical(r, mapping)) {
      missingCount[k] = (missingCount[k] || 0) + 1;
      if (!examples[k]) examples[k] = String(getField(r, 'account_no', mapping));
    }
  }

  const label = (k) => `"${(ALIASES[k] || [k])[0]}"`;
  const totalReal = identified.length;

  const extraHeaders = new Set();
  for (const p of (extraParsedList || []).filter(Boolean)) {
    for (const h of (p[0] || [])) extraHeaders.add(String(h ?? '').trim());
  }
  const isInSomeSheet = (k) => (ALIASES[k] || [k]).some((a) => extraHeaders.has(a))
    || (mapping && mapping[k] && extraHeaders.has(mapping[k]));

  const absent = Object.keys(missingCount).filter((k) => missingCount[k] === totalReal);
  if (absent.length) {
    const present = absent.filter(isInSomeSheet);
    if (present.length && indexes.length) {
      const wanted = present.map(label).join(', ');
      const sample = String(getField(identified[0] || {}, 'account_no', mapping) || '?');
      throw new Error(
        `The sheet with ${wanted} is here, but not one account matched it. `
        + `Every Account No in the primary sheet failed to find a partner — for example "${sample}". `
        + `The two files are numbering accounts differently (leading zeros, a prefix, or a different ID). `
        + `Check that the Account No columns hold the same format in both files.`,
      );
    }
    const wanted = absent.map(label).join(', ');
    throw new Error(
      `Couldn't find ${wanted} in the uploaded sheets. Add the sheet that contains ${wanted}, `
      + `or map the column explicitly.`,
    );
  }

  const partial = Object.keys(missingCount).filter((k) => missingCount[k] > 0 && k !== 'account_no');
  if (partial.length) {
    const detail = partial
      .map((k) => `${missingCount[k].toLocaleString('en-IN')} of ${totalReal.toLocaleString('en-IN')} rows have no ${label(k)} (e.g. account ${examples[k]})`)
      .join('; ');
    throw new Error(
      `This upload would report the wrong number, so it has been stopped. ${detail}. `
      + `Those accounts would be counted as ₹0 and the recovery figure would be understated. `
      + `Add the sheet that covers every account, or remove the rows that aren't in it.`,
    );
  }

  const warnings = [];
  if (corrupted) {
    warnings.push(
      `${corrupted} row${corrupted === 1 ? '' : 's'} have an Excel-corrupted Account No (e.g. "7.4787E+15") `
      + `and could not be matched. Re-export the sheet with the Account No column formatted as Text.`,
    );
  }

  for (let s = 0; s < indexes.length; s++) {
    const rec = indexes[s]._recovered || 0;
    if (!rec) continue;
    const via = (indexes[s]._via || []).map((c) => `"${c}"`).join(' / ') || 'another column';
    warnings.push(
      `"${sheetName(s)}": the Account No column was corrupted by Excel on ${rec.toLocaleString('en-IN')} row${rec === 1 ? '' : 's'} `
      + `(written as "7.47678E+15", which collapses different accounts onto one value). `
      + `The real account number was recovered from ${via} in the same file and VERIFIED — each recovered number was `
      + `re-rounded the way Excel rounds, and it lands back exactly on the corrupted value, so it is provably the same account. `
      + `Nothing was guessed. To remove this warning, ask for the export with Account No formatted as Text.`,
    );
  }

  for (let s = 0; s < indexes.length; s++) {
    const bad = indexes[s]._corrupt || 0;
    if (!bad) continue;
    warnings.push(
      `"${sheetName(s)}": ${bad.toLocaleString('en-IN')} row${bad === 1 ? ' has' : 's have'} an Account No destroyed by Excel `
      + `with no other column in the file carrying the real number. Those rows could not be joined to anything — `
      + `matching them would mean guessing, and a guessed account number attaches the wrong customer's balance. `
      + `Re-export with Account No formatted as Text.`,
    );
  }
  if (unmatched) {
    warnings.push(`${unmatched} row${unmatched === 1 ? '' : 's'} had no match in the additional sheet(s), but carried their own data.`);
  }

  for (let s = 0; s < indexes.length; s++) {
    if (!usable || !hits[s] || hits[s] === usable) continue;
    const pct = (hits[s] / usable) * 100;
    if (pct >= 99.5) continue;
    warnings.push(
      `"${sheetName(s)}" covers ${hits[s].toLocaleString('en-IN')} of ${usable.toLocaleString('en-IN')} accounts `
      + `(${pct.toFixed(1)}%). Anything it supplies — call activity, dispositions, our collection score — `
      + `is measured on those accounts only, not on the whole book.`,
    );
  }
  if (noAccount) {
    warnings.push(`${noAccount} row${noAccount === 1 ? '' : 's'} had no Account No and were skipped.`);
  }
  if (blankJunk) {
    warnings.push(`${blankJunk} blank row${blankJunk === 1 ? '' : 's'} at the end of the sheet were ignored.`);
  }

  const canonical = identified.map((r) => normalizeMap(r, mapping)).filter((r) => r.account_no);

  const seen = new Set();
  let duplicates = 0;
  for (const r of canonical) {
    if (isCorruptAccount(r.account_no)) continue;
    if (seen.has(r.account_no)) duplicates++; else seen.add(r.account_no);
  }
  if (duplicates) {
    warnings.push(
      `${duplicates.toLocaleString('en-IN')} account${duplicates === 1 ? ' appears' : 's appear'} more than once in the sheet, `
      + `so ${duplicates === 1 ? 'its balance is' : 'their balances are'} counted more than once. Deduplicate before relying on the totals.`,
    );
  }

  return {
    rows: canonical,
    stats: {
      primaryRows: primary.length, rowsUsed: canonical.length, extraSheets: indexes.length,
      matched, unmatched, corrupted, filledCells: enriched,
      skippedNoAccount: noAccount, blankRows: blankJunk, duplicates,

      sheetCoverage: indexes.map((_, i) => ({ name: sheetName(i), matched: hits[i], of: usable })),
    },
    warnings,
  };
}
