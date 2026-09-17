import { readSheet, detectSheetKind } from './sheet.mjs';
import { buildCanonicalRows } from './merge.mjs';
import { autoMap } from './normalize.mjs';
import { rollUpCallLog, applyCallLog } from './calllog.mjs';
import { sliceCallLog, shortDate } from './bulk.mjs';
import { withBase } from './basepath.mjs';

const CHUNK_ROWS = 2500;

async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return { body: text, gzipped: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return { body: buf, gzipped: true };
}

async function post(payload, onRetry) {
  const { body, gzipped } = await gzip(JSON.stringify(payload));
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (gzipped) headers['x-gzip'] = '1';

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(withBase('/api/ingest/chunk'), { method: 'POST', headers, body });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    if (attempt === 0 && res.status >= 500) { onRetry?.(); continue; }
    throw new Error(j.error || `Upload failed (${res.status})`);
  }
  throw new Error('Upload failed after a retry.');
}

const breathe = () => new Promise((r) => setTimeout(r, 0));

const fmt = (n) => Number(n).toLocaleString('en-IN');

async function readOne(f) {
  const buf = await f.arrayBuffer();
  const rows = readSheet(buf, f.name);
  return { file: f, name: f.name, rows, kind: detectSheetKind(rows[0]) };
}

const slotLabel = (s, primary, cyc) => (s === primary ? (cyc ? 'CYC / PDD (primary)' : 'Merged sheet')
  : (s.kind === 'status' ? 'Status'
    : s.kind === 'calllog' ? 'AI call log'
      : s.kind === 'leads' ? 'Lead outcome' : 'Additional'));

function joinSheets(sheets, mapping, onProgress) {
  const cyc = sheets.find((s) => s.kind === 'cyc');
  const primary = cyc || sheets[0];

  const callSheets = sheets.filter((s) => s.kind === 'calllog');
  const lookups = sheets.filter((s) => s !== primary && s.kind !== 'calllog');

  onProgress({ phase: 'joining', step: 'join', note: 'Joining on Account No…' });

  const map = mapping || autoMap(sheets.filter((s) => s.kind !== 'calllog').flatMap((s) => s.rows[0]));
  const { rows: canon, stats, warnings } = buildCanonicalRows(
    primary.rows, lookups.map((s) => s.rows), map, lookups.map((s) => s.name),
  );

  let callStats = null;
  for (const s of callSheets) {
    onProgress({ phase: 'joining', step: 'rollup', note: `Rolling up ${s.name}…` });
    const log = rollUpCallLog(s.rows);
    const applied = applyCallLog(canon, log, { name: s.name });
    warnings.push(...applied.warnings);
    callStats = {
      file: s.name,
      attempts: log.stats.attempts,
      logAccounts: log.stats.accounts,
      connected: log.stats.connected,
      voicemail: log.stats.voicemail,
      dates: log.stats.dates,
      maxAttempt: log.stats.maxAttempt,
      ...applied,
    };
    delete callStats.warnings;
  }

  const sources = sheets.map((s) => ({
    slot: slotLabel(s, primary, cyc),
    name: s.name,
    rows: Math.max(0, s.rows.length - 1),
    detected: s.kind,
    ...(s.through ? { through: s.through } : {}),
  }));

  return { canon, stats, warnings, callStats, sources, primary };
}

async function sendDay(canon, meta, onProgress, [from, to] = [45, 93]) {
  const width = to - from;
  const at = (frac) => from + width * frac;
  const { batchId } = await post({ phase: 'begin', ...meta });

  const total = Math.ceil(canon.length / CHUNK_ROWS);
  for (let i = 0; i < total; i++) {
    const part = canon.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS);
    await post({ phase: 'chunk', batchId, reportDate: meta.reportDate, rows: part },
      () => onProgress({ phase: 'sending', pct: at(i / total), note: 'Retrying a chunk…' }));
    onProgress({
      phase: 'sending',
      pct: at((i + 1) / total),
      note: `Sent ${fmt(Math.min((i + 1) * CHUNK_ROWS, canon.length))} of ${fmt(canon.length)}`,
    });
  }

  onProgress({ phase: 'building', pct: to, note: 'Building the report…' });
  return post({ phase: 'commit', batchId, ...meta });
}

export async function uploadFiles(files, { reportDate, slot = 1, mapping = null }, onProgress = () => {}) {
  onProgress({ phase: 'reading', pct: 5, note: 'Reading the files…' });

  const sheets = [];
  for (const f of files) {
    if (!f) continue;
    sheets.push(await readOne(f));
    onProgress({ phase: 'reading', pct: 5 + (25 * sheets.length) / files.length, note: `Read ${f.name}` });
  }
  if (!sheets.length) throw new Error('No files to upload.');

  const { canon, stats, warnings, callStats, sources, primary } = joinSheets(
    sheets, mapping, (p) => onProgress({ phase: p.phase, pct: p.step === 'rollup' ? 38 : 35, note: p.note }),
  );

  onProgress({ phase: 'sending', pct: 45, note: `${fmt(canon.length)} accounts joined — sending…` });

  const meta = { reportDate, slot, filename: primary.name, sources };
  const res = await sendDay(canon, meta, onProgress, [45, 93]);

  onProgress({ phase: 'done', pct: 100, note: 'Done.' });
  return { ...res, stats, warnings, sheets: sources, callStats };
}

export async function uploadDays({ cyc, callLog = null, extras = [] }, days, { reportDate }, onProgress = () => {}) {
  if (!cyc) throw new Error('Add the CYC / PDD file. It is the book RBL gave us, and it decides which accounts are in this report.');
  if (!days || days.length < 2) throw new Error('A batch needs at least two status files — one per day.');
  for (const d of days) {
    if (!d.file) throw new Error(`Day ${d.slot} has no status file.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.cutoff ?? ''))) throw new Error(`Day ${d.slot} ("${d.file.name}") has no date, so its share of the call log cannot be decided.`);
  }
  const slots = days.map((d) => Number(d.slot));
  for (let i = 1; i < slots.length; i++) {
    if (!(slots[i] > slots[i - 1])) throw new Error(`Days must be uploaded in ascending order — got Day ${slots[i - 1]} then Day ${slots[i]}.`);
  }
  const n = days.length;
  const dayNote = (i, s) => `Day ${days[i].slot} (${i + 1} of ${n}) · ${s}`;

  onProgress({ phase: 'reading', pct: 2, note: `Reading ${cyc.name}…` });
  const cycSheet = await readOne(cyc);
  if (cycSheet.kind === 'calllog') throw new Error(`"${cyc.name}" is the AI call log, not the CYC / PDD book. Put the book in the first slot.`);
  if (cycSheet.kind === 'status') throw new Error(`"${cyc.name}" looks like a status file (account and status only), not the CYC / PDD book. Put the book in the first slot.`);

  const extraSheets = [];
  for (const f of extras || []) {
    if (!f) continue;
    onProgress({ phase: 'reading', pct: 6, note: `Reading ${f.name}…` });
    extraSheets.push(await readOne(f));
  }

  let logSheet = null;
  if (callLog) {
    onProgress({ phase: 'reading', pct: 8, note: `Reading ${callLog.name}…` });
    logSheet = await readOne(callLog);
    if (logSheet.kind !== 'calllog') {
      throw new Error(`"${callLog.name}" does not look like the AI call log (no "External ID" and "Attempt Number" columns), so it cannot be cut into days. Check the file, or upload one day at a time.`);
    }
  }

  const joined = [];
  const batchWarnings = [];
  let lastSlice = null;
  for (let i = 0; i < n; i++) {
    const d = days[i];
    const base = 12 + (43 * i) / n;
    const step = 43 / n;
    onProgress({ phase: 'reading', pct: base, note: dayNote(i, `reading ${d.file.name}…`) });
    await breathe();
    let statusSheet;
    try {
      statusSheet = await readOne(d.file);
    } catch (e) {
      throw new Error(`Nothing was uploaded. Day ${d.slot} ("${d.file.name}") could not be read: ${e.message || e}`);
    }
    if (statusSheet.kind === 'calllog') throw new Error(`Nothing was uploaded. Day ${d.slot}: "${d.file.name}" is the AI call log, not a status file.`);
    if (statusSheet.kind === 'cyc') throw new Error(`Nothing was uploaded. Day ${d.slot}: "${d.file.name}" is a CYC / PDD book, not a status file.`);

    const sheets = [cycSheet, statusSheet, ...extraSheets];
    let slice = null;
    if (logSheet) {
      slice = sliceCallLog(logSheet.rows, d.cutoff);
      lastSlice = slice;

      if (!slice.kept) {
        throw new Error(
          `Nothing was uploaded. Day ${d.slot} ("${d.file.name}"): not one call in "${callLog.name}" was placed on or before ${shortDate(d.cutoff)}`
          + `${slice.firstInLog ? ` — the log starts on ${shortDate(slice.firstInLog)}` : ''}. Check the date on this status file.`,
        );
      }
      sheets.push({ ...logSheet, rows: slice.rows, through: d.cutoff });
    }

    onProgress({ phase: 'joining', pct: base + step * 0.5, note: dayNote(i, 'joining on Account No…') });
    await breathe();
    let j;
    try {
      j = joinSheets(sheets, null, (p) => onProgress({ phase: p.phase, pct: base + step * (p.step === 'rollup' ? 0.8 : 0.6), note: dayNote(i, p.note) }));
    } catch (e) {
      throw new Error(`Nothing was uploaded. Day ${d.slot} ("${d.file.name}"): ${e.message || e}`);
    }
    if (j.callStats && slice) {
      j.callStats = { ...j.callStats, through: d.cutoff, kept: slice.kept, cutAway: slice.dropped, undated: slice.undated };
    }
    joined.push({ slot: d.slot, cutoff: d.cutoff, statusFile: d.file.name, ...j });

    statusSheet = null;
  }

  if (lastSlice) {
    const last = days[n - 1].cutoff;
    if (lastSlice.dropped) {
      const after = lastSlice.dropped;
      batchWarnings.push(
        `"${callLog.name}" runs to ${shortDate(lastSlice.lastInLog)}, after the last day (Day ${days[n - 1].slot}, ${shortDate(last)}). `
        + `${fmt(after)} call attempt${after === 1 ? '' : 's'} placed after ${shortDate(last)} ${after === 1 ? 'was' : 'were'} not used on any day. `
        + `If calling really ran that long, the book has more days than were uploaded.`,
      );
    }
    const undated = lastSlice.undated;
    if (undated) {
      batchWarnings.push(
        `"${callLog.name}": ${fmt(undated)} call attempt${undated === 1 ? ' has' : 's have'} no readable Call Timestamp, `
        + `so ${undated === 1 ? 'it' : 'they'} could not be placed on a day and ${undated === 1 ? 'is' : 'are'} left out of every day.`,
      );
    }
  }

  const built = [];
  for (let i = 0; i < n; i++) {
    const j = joined[i];
    const from = 55 + (43 * i) / n;
    const to = 55 + (43 * (i + 1)) / n;
    onProgress({ phase: 'sending', pct: from, note: dayNote(i, `${fmt(j.canon.length)} accounts joined — sending…`) });
    const meta = { reportDate, slot: j.slot, filename: j.primary.name, sources: j.sources };
    let res;
    try {
      res = await sendDay(j.canon, meta, (p) => onProgress({ ...p, note: dayNote(i, p.note) }), [from, to]);
    } catch (e) {
      const done = built.map((b) => `Day ${b.slot}`);
      const notStarted = joined.slice(i + 1).map((x) => `Day ${x.slot}`);
      throw new Error(
        `${done.length ? `${done.join(', ')} ${done.length === 1 ? 'was' : 'were'} built. ` : ''}`
        + `Day ${j.slot} failed while sending: ${e.message || e}`
        + `${notStarted.length ? ` ${notStarted.join(', ')} ${notStarted.length === 1 ? 'was' : 'were'} not started.` : ''}`
        + ` Re-upload from Day ${j.slot} — re-uploading a day replaces it.`,
      );
    }
    built.push({
      slot: j.slot, batchId: res.batchId, rowCount: res.rowCount, cutoff: j.cutoff, statusFile: j.statusFile,
      stats: j.stats, warnings: j.warnings, callStats: j.callStats, sheets: j.sources,
    });
    joined[i] = null;
  }

  onProgress({ phase: 'done', pct: 100, note: 'Done.' });
  return { reportDate, built: built.length, days: built, warnings: batchWarnings };
}
