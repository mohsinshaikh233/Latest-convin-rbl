import { parseStatusDate } from './statusdate.mjs';
import { dateOnly } from './normalize.mjs';

const ISO = /(\d{4})-(\d{2})-(\d{2})/;
const validIso = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

export function statusDateOf(filename) {
  const rbl = parseStatusDate(String(filename ?? ''));
  if (rbl) return rbl;
  const m = String(filename ?? '').match(ISO);
  if (m && validIso(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function shortDate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso ?? '');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${+m[3]} ${MON[+m[2] - 1] ?? m[2]} ${m[1]}`;
}

export function planDays(files, firstDay = 1) {
  const problems = [];
  const first = Number(firstDay);
  if (!Number.isInteger(first) || first < 1) {
    problems.push(`The first day must be a whole number, 1 or more — got "${firstDay}".`);
  }
  const start = Number.isInteger(first) && first >= 1 ? first : 1;

  const entries = (files || []).map((f, i) => ({ ...f, date: f.date || null, _i: i }));

  entries.sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : a._i - b._i;
    if (a.date) return -1;
    if (b.date) return 1;
    return a._i - b._i;
  });
  const days = entries.map((e, i) => {
    const { _i, ...rest } = e;
    return { ...rest, day: start + i };
  });

  if (days.length >= 2) {
    for (const d of days) {
      if (!d.date) problems.push(`"${d.name}" has no date in its name. Set the date this status file was pulled — it decides which calls belong to Day ${d.day}.`);
    }
    const byDate = new Map();
    for (const d of days) {
      if (!d.date) continue;
      if (!byDate.has(d.date)) byDate.set(d.date, []);
      byDate.get(d.date).push(d.name);
    }
    for (const [date, names] of byDate) {
      if (names.length < 2) continue;
      problems.push(`${names.length} status files are dated ${shortDate(date)}: ${names.map((n) => `"${n}"`).join(', ')}. A day has one status file — remove one, or give it a different date.`);
    }
  }

  return { days, problems };
}

export function sliceCallLog(parsed, cutoff) {
  if (!parsed || !parsed.length) throw new Error('The AI call log is empty.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cutoff ?? ''))) {
    throw new Error(`Cannot cut the call log at "${cutoff}" — that is not a date.`);
  }
  const header = parsed[0].map((h) => String(h ?? '').trim());
  const tsIdx = header.findIndex((h) => h.toLowerCase() === 'call timestamp');
  if (tsIdx < 0) {
    throw new Error('The AI call log has no "Call Timestamp" column, so it cannot be cut into days. Upload one status file at a time, or use an export that carries the timestamp.');
  }

  const rows = [parsed[0]];
  let kept = 0; let dropped = 0; let undated = 0;
  let lastKept = ''; let firstInLog = ''; let lastInLog = '';
  for (let i = 1; i < parsed.length; i++) {
    const rec = parsed[i];
    if (!rec || rec.length < 2) continue;
    const day = dateOnly(rec[tsIdx]);
    if (!day) { undated++; continue; }
    if (!firstInLog || day < firstInLog) firstInLog = day;
    if (day > lastInLog) lastInLog = day;
    if (day <= cutoff) {
      rows.push(rec); kept++;
      if (day > lastKept) lastKept = day;
    } else {
      dropped++;
    }
  }
  return { rows, kept, dropped, undated, lastKept, firstInLog, lastInLog };
}
