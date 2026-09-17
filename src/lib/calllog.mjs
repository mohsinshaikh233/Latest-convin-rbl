import { dateOnly, normalizeAccount } from './normalize.mjs';

const COL = {
  account: 'External ID',
  attempt: 'Attempt Number',
  placed: 'Call Timestamp',
  answered: 'Call Answered Timestamp',
  seconds: 'Call Duration (Seconds)',
  status: 'Call Status',
  l1: 'Sense Disposition L1',
  l2: 'Sense Disposition L2',
  line: 'From Phone Num',
};

export function detectCallLog(headers) {
  const h = new Set((headers || []).map((x) => String(x ?? '').trim().toLowerCase()));
  return h.has('external id') && h.has('attempt number')
    && (h.has('call answered timestamp') || h.has('call timestamp'));
}

const L2_RANK = {
  'On Call Payment Done': 100,
  Paid: 95,
  'Promise to Pay Later': 80,
  "Can't Pay - Request for Payment Plan": 72,
  'Human Callback Requested': 64,
  'Follow-Up': 56,
  "Won't Pay - Wants Statement": 48,
  "Won't Pay - Re-Waiver Required": 47,
  "Won't Pay - Dispute": 46,
  "Won't Pay - Service Issue / Complaints": 45,
  "Can't Pay - Financial Crises": 44,
  "Won't Pay - Intention Issue": 43,
  'Potential Complaint': 30,
  'Excessive Calls Limit': 22,
  'Message to Third Party': 14,
};
const UNKNOWN_RANK = 40;
const rankOf = (l1, l2) => {
  const k = String(l2 ?? '').trim();
  if (k) return L2_RANK[k] ?? UNKNOWN_RANK;
  return String(l1 ?? '').trim() ? UNKNOWN_RANK : -1;
};

const PAID_L2 = new Set(['Paid', 'On Call Payment Done']);

const hourOf = (v) => {
  const m = String(v ?? '').match(/[T ](\d{2}):\d{2}/);
  return m ? m[1] : '';
};

const lineTag = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d ? d.slice(-4) : '';
};
const int = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

export const encodeHist = (map) => [...map.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  .map(([k, v]) => `${k}:${v.attempts}:${v.connected}`)
  .join('|');

export function decodeHist(s) {
  const out = [];
  for (const part of String(s ?? '').split('|')) {
    if (!part) continue;
    const bits = part.split(':');
    if (bits.length < 3) continue;
    const attempts = Number(bits[1]);
    const connected = Number(bits[2]);
    if (!Number.isFinite(attempts) || !Number.isFinite(connected)) continue;
    out.push({ key: bits[0], attempts, connected });
  }
  return out;
}

const maskOf = (attempts) => {
  const max = attempts.length - 1;
  let s = '';
  for (let i = 1; i <= max; i++) {
    const a = attempts[i];
    s += a === undefined ? '-' : (a.connected ? '1' : '0');
  }
  return s;
};

export function rollUpCallLog(parsed) {
  if (!parsed || parsed.length < 2) {
    throw new Error('The AI call log has no data rows in it.');
  }
  const header = parsed[0].map((h) => String(h ?? '').trim());
  const at = {};
  for (const [k, name] of Object.entries(COL)) at[k] = header.indexOf(name);
  if (at.account < 0) {
    throw new Error(`The AI call log has no "${COL.account}" column, so its calls cannot be attached to an account.`);
  }
  if (at.attempt < 0) {
    throw new Error(`The AI call log has no "${COL.attempt}" column. Attempt numbers are explicit in this export and are never inferred from row order.`);
  }

  const byAccount = new Map();
  const stats = {
    rows: 0, skippedNoAccount: 0, attempts: 0, connected: 0, voicemail: 0,
    talkSeconds: 0, accounts: 0, maxAttempt: 0, unnumbered: 0, undated: 0, dates: new Set(),
  };
  const cell = (rec, i) => (i >= 0 ? String(rec[i] ?? '').trim() : '');

  const accountKey = (raw) => {
    if (/^\d{26,}$/.test(raw)) {
      const d = raw.slice(-8);
      const dd = +d.slice(0, 2); const mm = +d.slice(2, 4); const yy = +d.slice(4);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy >= 2000 && yy <= 2100) {
        return normalizeAccount(raw.slice(0, -8));
      }
    }
    return normalizeAccount(raw);
  };

  for (let i = 1; i < parsed.length; i++) {
    const rec = parsed[i];
    if (!rec || rec.length < 2) continue;

    const key = accountKey(cell(rec, at.account));
    if (!key) { stats.skippedNoAccount++; continue; }
    stats.rows++;

    let a = byAccount.get(key);
    if (!a) {
      a = {
        attempts: 0, connected: 0, voicemailCalls: 0, voicemailSeconds: 0, talkSeconds: 0,
        firstCall: '', lastCall: '',
        hours: new Map(), lines: new Map(),
        byAttempt: [],
        maxAttempt: 0,
        firstPaidAttempt: 0, dncAttempt: 0,
        paid: false, ptp: false, refused: false, dnc: false, complaint: false,
        bestRank: -1, bestAttempt: -1, l1: '', l2: '',
      };
      byAccount.set(key, a);
    }

    const n = int(cell(rec, at.attempt));
    const answeredAt = cell(rec, at.answered);
    const connected = answeredAt !== '';
    const secs = connected ? Math.max(0, int(cell(rec, at.seconds))) : 0;
    const status = cell(rec, at.status).toLowerCase();
    const l1 = cell(rec, at.l1);
    const l2 = cell(rec, at.l2);
    const placed = cell(rec, at.placed);
    const day = dateOnly(placed);

    a.attempts++;
    stats.attempts++;
    if (connected) {
      a.connected++; stats.connected++;
      a.talkSeconds += secs; stats.talkSeconds += secs;

      if (status === 'voicemail') {
        a.voicemailCalls++; a.voicemailSeconds += secs; stats.voicemail++;
      }
    }

    if (day) {
      stats.dates.add(day);
      if (!a.firstCall || day < a.firstCall) a.firstCall = day;
      if (!a.lastCall || day > a.lastCall) a.lastCall = day;
    }

    const hh = hourOf(placed);
    if (hh) {
      let h = a.hours.get(hh);
      if (!h) { h = { attempts: 0, connected: 0 }; a.hours.set(hh, h); }
      h.attempts++; if (connected) h.connected++;
    }

    const ln = lineTag(cell(rec, at.line));
    if (ln) {
      let l = a.lines.get(ln);
      if (!l) { l = { attempts: 0, connected: 0 }; a.lines.set(ln, l); }
      l.attempts++; if (connected) l.connected++;
    }

    if (n > 0) {
      a.byAttempt[n] = { connected, l1, l2 };
      if (n > a.maxAttempt) a.maxAttempt = n;
      if (n > stats.maxAttempt) stats.maxAttempt = n;
    } else {
      stats.unnumbered++;
    }
    if (!day) stats.undated++;

    if (PAID_L2.has(l2)) {
      a.paid = true;
      if (n > 0 && (a.firstPaidAttempt === 0 || n < a.firstPaidAttempt)) a.firstPaidAttempt = n;
    }
    if (l2 === 'Promise to Pay Later') a.ptp = true;
    if (l2 === 'Potential Complaint') a.complaint = true;
    if (l1 === 'Refused to Pay') a.refused = true;
    if (l1 === 'DNC') {
      a.dnc = true;
      if (n > 0 && (a.dncAttempt === 0 || n < a.dncAttempt)) a.dncAttempt = n;
    }

    const rank = rankOf(l1, l2);
    if (rank > a.bestRank || (rank === a.bestRank && rank >= 0 && n > a.bestAttempt)) {
      a.bestRank = rank; a.bestAttempt = n; a.l1 = l1; a.l2 = l2;
    }
  }

  stats.accounts = byAccount.size;
  stats.dates = [...stats.dates].sort();
  return { byAccount, stats };
}

export function callFields(a) {
  let dialsAfterDnc = 0;
  if (a.dncAttempt > 0) {
    for (let i = a.dncAttempt + 1; i <= a.maxAttempt; i++) if (a.byAttempt[i]) dialsAfterDnc++;
  }
  return {
    ai_attempts: a.attempts,
    ai_connected_calls: a.connected,
    ai_connected_seconds: a.talkSeconds,
    disp_l1: a.l1,
    disp_l2: a.l2,
    first_call_at: a.firstCall,
    last_call_at: a.lastCall,
    attempts_by_hour: encodeHist(a.hours),
    outbound_lines: encodeHist(a.lines),
    attempt_mask: maskOf(a.byAttempt),
    max_attempt: a.maxAttempt,
    attempt_first_paid: a.firstPaidAttempt,
    dnc_attempt: a.dncAttempt,
    dials_after_dnc: dialsAfterDnc,
    voicemail_calls: a.voicemailCalls,
    voicemail_seconds: a.voicemailSeconds,
    complaint_flag: a.complaint,
    dnc_flag: a.dnc,
    refused_flag: a.refused,
    ptp_flag: a.ptp,

    paid_flag: a.paid ? 'YES' : (a.connected ? 'NO' : 'N/A'),
    promise_flag: a.ptp ? 'YES' : (a.connected ? 'NO' : 'N/A'),
    refusal_flag: a.refused ? 'YES' : (a.connected ? 'NO' : 'N/A'),
  };
}

export function emptyCallFields() {
  return {
    ai_attempts: 0, ai_connected_calls: 0, ai_connected_seconds: 0,
    disp_l1: '', disp_l2: '',
    first_call_at: '', last_call_at: '',
    attempts_by_hour: '', outbound_lines: '', attempt_mask: '',
    max_attempt: 0, attempt_first_paid: 0, dnc_attempt: 0, dials_after_dnc: 0,
    voicemail_calls: 0, voicemail_seconds: 0,
    complaint_flag: false, dnc_flag: false, refused_flag: false, ptp_flag: false,
    paid_flag: 'N/A', promise_flag: 'N/A', refusal_flag: 'N/A',
  };
}

const keyForms = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return [];
  const stripped = s.replace(/^0+/, '');
  return stripped && stripped !== s ? [s, stripped] : [s];
};

export function applyCallLog(rows, log, { name = 'the AI call log' } = {}) {
  const index = new Map();
  for (const [k, v] of log.byAccount) for (const f of keyForms(k)) if (!index.has(f)) index.set(f, v);

  const usedKeys = new Set();
  let matched = 0;
  let notCalled = 0;

  for (const r of rows) {
    let hit = null;
    for (const f of keyForms(r.account_no)) {
      if (index.has(f)) { hit = index.get(f); break; }
    }
    if (hit) {
      matched++;
      usedKeys.add(hit);
      Object.assign(r, callFields(hit));
    } else {
      notCalled++;
      Object.assign(r, emptyCallFields());
    }
  }

  if (rows.length && matched === 0) {
    const theirs = [...log.byAccount.keys()][0] ?? '(none)';
    const ours = rows[0]?.account_no || '?';
    throw new Error(
      `"${name}" did not match a single account in the book, so none of its ${log.stats.attempts.toLocaleString('en-IN')} call attempts were used. `
      + `The book numbers accounts like "${ours}", the call log like "${theirs}". `
      + `Either it is the wrong campaign export, or the two files number accounts differently. `
      + `Uploading it as-is would report a book that was never called.`,
    );
  }

  const notInBook = log.byAccount.size - usedKeys.size;
  const warnings = [];
  if (log.stats.unnumbered) {
    warnings.push(
      `"${name}": ${log.stats.unnumbered.toLocaleString('en-IN')} call attempt${log.stats.unnumbered === 1 ? ' has' : 's have'} no Attempt Number. `
      + `${log.stats.unnumbered === 1 ? 'It is' : 'They are'} counted in the dial totals but left off the conversion-by-attempt curve — `
      + `the file is not sorted by account, so a position inferred from row order would be a guess, not a measurement.`,
    );
  }
  if (log.stats.undated) {
    warnings.push(
      `"${name}": ${log.stats.undated.toLocaleString('en-IN')} call attempt${log.stats.undated === 1 ? ' has' : 's have'} no readable Call Timestamp, `
      + `so ${log.stats.undated === 1 ? 'it is' : 'they are'} absent from the hour-of-day chart. Every other figure still counts ${log.stats.undated === 1 ? 'it' : 'them'}.`,
    );
  }
  if (notCalled) {
    warnings.push(
      `${notCalled.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} accounts in the book have no calls in "${name}". `
      + `They are counted in full — the book is RBL's, not ours — and they show as never attempted.`,
    );
  }
  if (notInBook) {
    warnings.push(
      `"${name}" contains ${notInBook.toLocaleString('en-IN')} account${notInBook === 1 ? '' : 's'} that ${notInBook === 1 ? 'is' : 'are'} not in this CYC book `
      + `(a different cycle). ${notInBook === 1 ? 'It was' : 'They were'} dropped: the book decides which accounts exist, and adding accounts the bank did not send us `
      + `would report a campaign larger than the one they asked for.`,
    );
  }
  return { matched, notCalled, notInBook, warnings };
}
