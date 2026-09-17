import { BAND_ORDER, isResolved, languageOf, outcomeLabel, OUTCOME_ORDER } from './normalize.mjs';
import { decodeHist } from './calllog.mjs';
import { PAYLOAD_VERSION } from './payload_version.mjs';
import {
  featurize, trainPropensity, score, computeLifts,
  buildCategoricalSpec, encodeCategorical, featureNamesWith,
  MODEL_NAME, MODEL_VERSION,
} from './model.mjs';

const DUR_ORDER = ['Not connected', '<30s', '30–60s', '1–2 min', '2–5 min', '>5 min'];
const ATT_ORDER = ['1–3', '4–6', '7–9', '10–12', '13+'];

const BLIND_MIN = 25;

const CELL_MIN = 30;
const dayOf = (r) => String(r.last_call_at || '').slice(0, 10);

const netOf = (tot, byDate, blind, fields) => {
  const o = {};
  for (const f of fields) o[f] = tot[f] || 0;
  for (const d of blind) {
    const c = byDate?.get(d);
    if (!c) continue;
    for (const f of fields) o[f] -= c[f] || 0;
  }
  return o;
};

const bump = (parent, date, fields) => {
  if (!date) return null;
  if (!parent.byDate) parent.byDate = new Map();
  let c = parent.byDate.get(date);
  if (!c) { c = {}; for (const f of fields) c[f] = 0; parent.byDate.set(date, c); }
  return c;
};
const durBucket = (s) => (s <= 0 ? 'Not connected' : s < 30 ? '<30s' : s < 60 ? '30–60s' : s < 120 ? '1–2 min' : s < 300 ? '2–5 min' : '>5 min');
const attBand = (a) => (a <= 3 ? '1–3' : a <= 6 ? '4–6' : a <= 9 ? '7–9' : a <= 12 ? '10–12' : '13+');
const U = (x) => String(x ?? '').trim().toUpperCase();

const INTENSITY_ORDER = ['Never dialled', '1–3', '4–6', '7–9', '10–12', '13+'];
const intensityBand = (a) => (a <= 0 ? 'Never dialled' : attBand(a));

const CONTACT_ORDER = ['Never reached', '1', '2–3', '4–6', '7+'];
const contactBand = (c) => (c <= 0 ? 'Never reached' : c === 1 ? '1' : c <= 3 ? '2–3' : c <= 6 ? '4–6' : '7+');

const maskAccount = (a) => {
  const d = String(a ?? '').replace(/\D/g, '');
  return d ? `•••• ${d.slice(-6)}` : '—';
};
const cr = (x) => (Math.abs(x) >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : Math.abs(x) >= 1e5 ? `₹${(x / 1e5).toFixed(2)} L` : `₹${Math.round(x).toLocaleString('en-IN')}`);

const cfg = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const AGENCY_PCT = cfg('AGENCY_COMMISSION_PCT', 12);
const CYCLES_PER_YEAR = cfg('CYCLES_PER_YEAR', 12);
const CYCLE_DECAY = cfg('CYCLE_DECAY', 0.85);

const tierCuts = (baseRate) => ({ high: baseRate, medium: baseRate / 2 });

export { PAYLOAD_VERSION };

export class Aggregator {
  constructor() {
    this.N = 0; this.res = 0;
    this.sumOut = 0; this.sumMinDue = 0; this.recovered = 0;
    this.attempts = 0; this.connected = 0; this.secs = 0;
    this.entity = { promise: {}, paid: {}, refusal: {} };
    this.disp = new Map(); this.dispL2 = new Map(); this.band = new Map(); this.region = new Map(); this.state = new Map();

    this.cycleBucket = new Map(); this.language = new Map(); this.bucketRegion = new Map();
    this.hasCycleBucketColumn = false;
    this.dur = new Map(); this.pm = new Map(); this.durL2 = new Map();
    this.fAttempted = 0; this.fConnected = 0; this.fQualified = 0; this.fPromise = 0; this.fPaid = 0;
    this.fPtpLater = 0; this.fPaidL2 = 0;

    this.rAttempted = 0; this.rConnected = 0; this.rQualified = 0; this.rPtpLater = 0; this.rPaidL2 = 0;
    this.top = [];
    this.openOut = 0;
    this.oppPromise = { count: 0, amount: 0 }; this.oppEngaged = { count: 0, amount: 0 }; this.oppClaimed = { count: 0, amount: 0 };
    this.tiers = { High: { count: 0, amount: 0 }, Medium: { count: 0, amount: 0 }, Low: { count: 0, amount: 0 } };
    this.dirtyAttempts = 0;
    this.paidYes = 0; this.paidYesRes = 0; this.saidNoRes = 0; this.promisedOpen = 0;
    this.dial = new Map();

    this.lastCall = new Map();

    this.X = []; this.Y = [];
    this.openX = []; this.openAmt = [];

    this.cats = []; this.openCats = [];

    this.seg = new Map();

    this.logged = 0;

    this.logAttempts = 0; this.logConnected = 0;
    this.hour = new Map();
    this.line = new Map();
    this.attN = new Map();
    this.maxAttemptSeen = 0;
    this.vmCalls = 0; this.vmSecs = 0; this.humanReached = 0;
    this.ptpAcc = 0; this.ptpRes = 0; this.ptpOut = 0; this.ptpRec = 0;
    this.cmpAcc = 0; this.cmpRes = 0; this.cmpOut = 0;
    this.dncAcc = 0; this.dncRes = 0; this.dncRedial = 0; this.dncRedialDials = 0;
    this.dncMaxAfter = 0; this.dncCmp = 0;
    this.refAcc = 0; this.refRes = 0;
    this.paidAcc = 0; this.paidRes = 0; this.firstPaidKnown = 0;
    this.intensity = new Map();
    this.contact = new Map();

    this.agency = new Map();
  }

  _em(kind, key, resolved) {
    const m = this.entity[kind];
    if (!m[key]) m[key] = { resolved: 0, unresolved: 0 };
    m[key][resolved ? 'resolved' : 'unresolved']++;
  }
  _geo(map, k, r, o, resolved) {
    if (!k) k = 'Unspecified';
    let e = map.get(k);
    if (!e) { e = { count: 0, outstanding: 0, recovered: 0, resolved: 0, unresolved: 0, minDue: 0, attempts: 0, connected: 0, outcomes: {} }; map.set(k, e); }
    e.count++; e.outstanding += o; e.minDue += r.minimum_amount_due; e.attempts += r.ai_attempts; e.connected += r.ai_connected_calls;
    if (resolved) { e.resolved++; e.recovered += o; } else e.unresolved++;

    const label = outcomeLabel(r);
    e.outcomes[label] = (e.outcomes[label] || 0) + 1;
  }

  _pushTop(r, o) {
    const t = this.top;
    if (t.length >= 20 && o <= t[t.length - 1].o) return;
    const item = { o, ref: maskAccount(r.account_no), state: r.primary_state || '—', connected: r.ai_connected_calls, ptp: U(r.promise_flag) === 'YES', status: r.status };
    let i = t.length; while (i > 0 && t[i - 1].o < o) i--;
    t.splice(i, 0, item); if (t.length > 20) t.length = 20;
  }

  _callLog(r, o, resolved) {
    const maxAttempt = Number(r.max_attempt) || 0;
    if (maxAttempt <= 0 && !String(r.attempt_mask || '')) return;
    this.logged++;
    this.logAttempts += Number(r.ai_attempts) || 0;
    this.logConnected += Number(r.ai_connected_calls) || 0;
    if (maxAttempt > this.maxAttemptSeen) this.maxAttemptSeen = maxAttempt;

    for (const h of decodeHist(r.attempts_by_hour)) {
      let e = this.hour.get(h.key);
      if (!e) { e = { attempts: 0, connected: 0 }; this.hour.set(h.key, e); }
      e.attempts += h.attempts; e.connected += h.connected;
    }
    for (const l of decodeHist(r.outbound_lines)) {
      let e = this.line.get(l.key);
      if (!e) { e = { attempts: 0, connected: 0 }; this.line.set(l.key, e); }
      e.attempts += l.attempts; e.connected += l.connected;
    }

    const mask = String(r.attempt_mask || '');
    for (let i = 0; i < mask.length; i++) {
      const c = mask[i];
      if (c !== '0' && c !== '1') continue;
      const e = this._att(i + 1);
      e.attempts++; if (c === '1') e.connected++;
    }

    const fp = Number(r.attempt_first_paid) || 0;
    if (fp > 0) {
      const e = this._att(fp);
      e.firstPaid++; if (resolved) e.firstPaidResolved++;
      this.firstPaidKnown++;
    }

    const vm = Number(r.voicemail_calls) || 0;
    this.vmCalls += vm;
    this.vmSecs += Number(r.voicemail_seconds) || 0;

    if ((Number(r.ai_connected_calls) || 0) > vm) this.humanReached++;

    if (r.ptp_flag) { this.ptpAcc++; this.ptpOut += o; if (resolved) { this.ptpRes++; this.ptpRec += o; } }
    if (r.complaint_flag) { this.cmpAcc++; this.cmpOut += o; if (resolved) this.cmpRes++; }
    if (r.refused_flag) { this.refAcc++; if (resolved) this.refRes++; }
    if (r.dnc_flag) {
      this.dncAcc++; if (resolved) this.dncRes++;
      if (r.complaint_flag) this.dncCmp++;
      const after = Number(r.dials_after_dnc) || 0;
      if (after > 0) { this.dncRedial++; this.dncRedialDials += after; if (after > this.dncMaxAfter) this.dncMaxAfter = after; }
    }
    if (fp > 0 || U(r.paid_flag) === 'YES') { this.paidAcc++; if (resolved) this.paidRes++; }
  }

  _att(n) {
    let e = this.attN.get(n);
    if (!e) { e = { attempts: 0, connected: 0, firstPaid: 0, firstPaidResolved: 0 }; this.attN.set(n, e); }
    return e;
  }
  add(r) {
    const o = r.total_outstanding, resolved = isResolved(r);

    const f = featurize(r);
    const cat = { segment: r.segment, lead_score: r.lead_score };
    this.X.push(f); this.Y.push(resolved ? 1 : 0); this.cats.push(cat);
    if (!resolved) { this.openX.push(f); this.openAmt.push(o); this.openCats.push(cat); }

    const sk = r.segment || 'Unspecified';
    let sv = this.seg.get(sk);
    if (!sv) { sv = { count: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.seg.set(sk, sv); }
    sv.count++; sv.outstanding += o;
    if (resolved) { sv.resolved++; sv.recovered += o; } else sv.unresolved++;
    this.N++; this.sumOut += o; this.sumMinDue += r.minimum_amount_due;
    this.attempts += r.ai_attempts; this.connected += r.ai_connected_calls; this.secs += r.ai_connected_seconds;
    if (resolved) { this.res++; this.recovered += o; }

    this._em('promise', r.promise_flag, resolved);
    this._em('paid', r.paid_flag, resolved);
    this._em('refusal', r.refusal_flag, resolved);

    const dn = r.disp_l1 || '(Not contacted)';
    let dd = this.disp.get(dn); if (!dd) { dd = { total: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.disp.set(dn, dd); }
    dd.total++; dd.outstanding += o; if (resolved) { dd.resolved++; dd.recovered += o; } else dd.unresolved++;

    const dn2 = r.disp_l2 || '(Not contacted)';
    let d2 = this.dispL2.get(dn2); if (!d2) { d2 = { total: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.dispL2.set(dn2, d2); }
    d2.total++; d2.outstanding += o; if (resolved) { d2.resolved++; d2.recovered += o; } else d2.unresolved++;

    const bk = r.curr_bal_band || 'Unspecified';
    let bb = this.band.get(bk); if (!bb) { bb = { count: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0 }; this.band.set(bk, bb); }
    bb.count++; bb.outstanding += o; if (resolved) { bb.resolved++; bb.recovered += o; } else bb.unresolved++;

    this._geo(this.region, r.region, r, o, resolved);
    this._geo(this.state, r.primary_state, r, o, resolved);

    this._geo(this.language, languageOf(r.primary_state), r, o, resolved);

    if (r.cycle_bucket !== null && r.cycle_bucket !== undefined) {
      this.hasCycleBucketColumn = true;
      const bk = r.cycle_bucket ? `B${r.cycle_bucket}` : '';
      this._geo(this.cycleBucket, bk, r, o, resolved);
      this._geo(this.bucketRegion, `${bk || 'Unspecified'}|${r.region || 'Unspecified'}`, r, o, resolved);
    }

    const day = dayOf(r);
    if (day) {
      let lc = this.lastCall.get(day);
      if (!lc) { lc = { n: 0, res: 0, attempts: 0, connected: 0, outstanding: 0 }; this.lastCall.set(day, lc); }
      lc.n++; lc.attempts += r.ai_attempts; lc.connected += r.ai_connected_calls; lc.outstanding += o;
      if (resolved) lc.res++;
    }

    const db = durBucket(r.ai_connected_seconds);
    let du = this.dur.get(db); if (!du) { du = { n: 0, res: 0, ptp: 0, paid: 0, ref: 0 }; this.dur.set(db, du); }
    du.n++; if (resolved) du.res++; if (U(r.promise_flag) === 'YES') du.ptp++; if (U(r.paid_flag) === 'YES') du.paid++; if (r.refusal_flag === 'YES') du.ref++;
    const duD = bump(du, day, ['n', 'res']);
    if (duD) { duD.n++; if (resolved) duD.res++; }

    const l2 = r.disp_l2 || '(No disposition)';
    let dl = this.durL2.get(l2);
    if (!dl) { dl = { n: 0, res: 0, secs: 0, recovered: 0, buckets: new Map() }; this.durL2.set(l2, dl); }
    dl.n++; dl.secs += r.ai_connected_seconds;
    if (resolved) { dl.res++; dl.recovered += o; }
    const dlD = bump(dl, day, ['n', 'res', 'secs', 'recovered']);
    if (dlD) { dlD.n++; dlD.secs += r.ai_connected_seconds; if (resolved) { dlD.res++; dlD.recovered += o; } }
    let bb2 = dl.buckets.get(db);
    if (!bb2) { bb2 = { n: 0, res: 0 }; dl.buckets.set(db, bb2); }
    bb2.n++; if (resolved) bb2.res++;
    const bb2D = bump(bb2, day, ['n', 'res']);
    if (bb2D) { bb2D.n++; if (resolved) bb2D.res++; }

    if (resolved && r.payment_mode && r.payment_mode !== 'NA') {
      let p = this.pm.get(r.payment_mode); if (!p) { p = { payments: 0, amount: 0 }; this.pm.set(r.payment_mode, p); }
      p.payments++; p.amount += o;
    }

    if (r.ai_attempts > 0 || r.ai_connected_calls > 0) { this.fAttempted++; if (resolved) this.rAttempted++; }
    if (r.ai_connected_calls > 0) { this.fConnected++; if (resolved) this.rConnected++; }
    if (r.ai_attempts <= 0 && r.ai_connected_calls > 0) this.dirtyAttempts++;
    if (r.qual_status === 'Qualified') { this.fQualified++; if (resolved) this.rQualified++; }
    if (U(r.promise_flag) === 'YES') this.fPromise++;
    if (U(r.paid_flag) === 'YES') { this.fPaid++; this.paidYes++; if (resolved) this.paidYesRes++; }

    if (r.disp_l2 === 'Promise to Pay Later') { this.fPtpLater++; if (resolved) this.rPtpLater++; }
    if (r.disp_l2 === 'Paid') { this.fPaidL2++; if (resolved) this.rPaidL2++; }

    this._pushTop(r, o);

    const ab = attBand(r.ai_attempts);
    let da = this.dial.get(ab); if (!da) { da = { n: 0, connect: 0, resolved: 0 }; this.dial.set(ab, da); }
    da.n++; if (r.ai_connected_calls > 0) da.connect++; if (resolved) da.resolved++;
    const daD = bump(da, day, ['n', 'connect', 'resolved']);
    if (daD) { daD.n++; if (r.ai_connected_calls > 0) daD.connect++; if (resolved) daD.resolved++; }

    if (!resolved) {
      this.openOut += o;
      if (U(r.promise_flag) === 'YES') { this.oppPromise.count++; this.oppPromise.amount += o; this.promisedOpen++; }
      if (r.ai_connected_seconds >= 120) { this.oppEngaged.count++; this.oppEngaged.amount += o; }
      if (U(r.paid_flag) === 'YES') { this.oppClaimed.count++; this.oppClaimed.amount += o; }
    } else if (U(r.paid_flag) === 'NO') this.saidNoRes++;

    const ib = intensityBand(r.ai_attempts);
    let iv = this.intensity.get(ib);
    if (!iv) { iv = { accounts: 0, resolved: 0, attempts: 0 }; this.intensity.set(ib, iv); }
    iv.accounts++; iv.attempts += r.ai_attempts; if (resolved) iv.resolved++;

    const cb = contactBand(r.ai_connected_calls);
    let cv = this.contact.get(cb);
    if (!cv) { cv = { accounts: 0, resolved: 0 }; this.contact.set(cb, cv); }
    cv.accounts++; if (resolved) cv.resolved++;

    const ak = String(r.ai_agency || '').trim() || 'Unspecified';
    let av = this.agency.get(ak);
    if (!av) { av = { count: 0, resolved: 0, unresolved: 0, outstanding: 0, recovered: 0, attempts: 0, connected: 0 }; this.agency.set(ak, av); }
    av.count++; av.outstanding += o; av.attempts += r.ai_attempts; av.connected += r.ai_connected_calls;
    if (resolved) { av.resolved++; av.recovered += o; } else av.unresolved++;

    this._callLog(r, o, resolved);
  }

  _outcomeWindow() {
    const days = [...this.lastCall.keys()].sort();
    if (!days.length) return { hasCallDates: false, blind: [], blindAccounts: 0 };

    const cohorts = days.map((d) => {
      const c = this.lastCall.get(d);
      return { date: d, ...c, resolutionPct: c.n ? c.res / c.n * 100 : 0 };
    });

    const blind = [];
    for (let i = cohorts.length - 1; i >= 0; i--) {
      const c = cohorts[i];
      if (c.res === 0 && c.n >= BLIND_MIN) blind.unshift(c.date); else break;
    }

    if (blind.length === cohorts.length) {
      return { hasCallDates: true, cohorts, blind: [], blindAccounts: 0, allZero: true };
    }

    const b = new Set(blind);
    const hit = cohorts.filter((c) => b.has(c.date));
    const sum = (f) => hit.reduce((a, c) => a + c[f], 0);
    return {
      hasCallDates: true,
      cohorts,
      blind,
      firstBlindDate: blind[0] || null,
      lastCallDate: days[days.length - 1],

      outcomeSeenTo: blind.length ? cohorts[cohorts.length - blind.length - 1].date : days[days.length - 1],
      blindAccounts: sum('n'),
      blindAttempts: sum('attempts'),
      blindConnected: sum('connected'),
      blindOutstanding: sum('outstanding'),
      measurableAccounts: this.N - sum('n'),
      attemptSharePct: this.attempts ? sum('attempts') / this.attempts * 100 : 0,
    };
  }

  static NOT_MEASURED = [
    {
      key: 'tonality',
      label: 'Tonality / sentiment',
      why: 'The call log has no tone or sentiment column. "Sense Disposition Reason" is a free-text sentence the model wrote about the call, not a score, and scoring it here would be us grading our own conversations with a number we invented.',
      need: 'A per-call sentiment or tone score from the speech pipeline.',
    },
    {
      key: 'cash',
      label: 'Cash actually collected (₹ paid)',
      why: 'Neither file carries an amount paid. Both carry OUTSTANDING. Every "recovered" figure on this report is the full outstanding of an account RBL\'s status file marked Resolved — the standard measure, and not the same thing as cash received in the period.',
      need: 'A payment/receipt feed with an amount and a value date.',
    },
    {
      key: 'agent',
      label: 'Per-agent / per-bot performance',
      why: 'There is no agent identifier. The only per-call handle is the outbound line it was dialled from, and a line is a trunk, not an agent — an account is rung from a dozen different ones. The outbound-line table is labelled as exactly that, and must not be read as "Agent A beat Agent B".',
      need: 'An agent_id or bot_version on the call attempt.',
    },
    {
      key: 'wpc',
      label: 'Wrong-party contact',
      why: 'No WPC flag exists in the export. It could be guessed at from dispositions like "Message to Third Party", but a compliance number that was inferred is a compliance number that will be wrong in front of a regulator.',
      need: 'An explicit right-party / wrong-party outcome on the attempt.',
    },
  ];

  _callSection(N, resolved, baseRatePct) {
    const blank = {
      present: false, accounts: 0, byHour: [], bestHours: [], byAttempt: [],
      lines: [], notMeasured: Aggregator.NOT_MEASURED,
    };
    if (!this.logged) return blank;

    const hourAttempts = [...this.hour.values()].reduce((a, h) => a + h.attempts, 0);
    const HOUR_MIN = Math.max(50, Math.round(hourAttempts * 0.02));
    const byHour = [...this.hour.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([hour, h]) => ({
        hour,
        attempts: h.attempts,
        connected: h.connected,
        connectPct: h.attempts ? h.connected / h.attempts * 100 : 0,
        sharePct: hourAttempts ? h.attempts / hourAttempts * 100 : 0,
        thin: h.attempts > 0 && h.attempts < HOUR_MIN,
      }));
    const bestHours = byHour.filter((h) => !h.thin)
      .slice().sort((a, b) => b.connectPct - a.connectPct).slice(0, 3);

    const attNums = [...this.attN.keys()].sort((a, b) => a - b);
    let cum = 0;
    const byAttempt = attNums.map((n) => {
      const e = this.attN.get(n);
      cum += e.firstPaid;
      return {
        attempt: n,
        dialled: e.attempts,
        connected: e.connected,
        connectPct: e.attempts ? e.connected / e.attempts * 100 : 0,
        firstPaid: e.firstPaid,
        firstPaidResolved: e.firstPaidResolved,
        firstPaidPct: e.attempts ? e.firstPaid / e.attempts * 100 : 0,
        cumFirstPaid: cum,
        cumFirstPaidPct: this.firstPaidKnown ? cum / this.firstPaidKnown * 100 : 0,
        thin: e.attempts > 0 && e.attempts < CELL_MIN,
      };
    });

    const flattensAt = byAttempt.find((a) => a.cumFirstPaidPct >= 90)?.attempt ?? null;
    const paidBeyondFlatten = flattensAt === null ? 0
      : byAttempt.filter((a) => a.attempt > flattensAt).reduce((s, a) => s + a.firstPaid, 0);
    const dialsBeyondFlatten = flattensAt === null ? 0
      : byAttempt.filter((a) => a.attempt > flattensAt).reduce((s, a) => s + a.dialled, 0);

    const dialled = this.fAttempted;
    const reached = this.fConnected;
    const humanConnected = Math.max(0, this.connected - this.vmCalls);

    return {
      present: true,
      accounts: this.logged,
      neverDialled: N - dialled,

      loggedAttempts: this.logAttempts,
      loggedConnected: this.logConnected,
      attemptsWithoutLog: Math.max(0, this.attempts - this.logAttempts),

      byHour,
      bestHours,

      byAttempt,
      flattensAt,
      paidBeyondFlatten,
      dialsBeyondFlatten,
      firstPaidAccounts: this.firstPaidKnown,
      paidAccounts: this.paidAcc,
      paidResolved: this.paidRes,
      maxAttempt: this.maxAttemptSeen,

      intensity: {
        book: N,
        dialledAccounts: dialled,
        attempts: this.attempts,
        connected: this.connected,
        avgAttemptsPerBookAccount: N ? this.attempts / N : 0,
        avgAttemptsPerDialled: dialled ? this.attempts / dialled : 0,
        avgConnectedPerBookAccount: N ? this.connected / N : 0,
        avgConnectedPerDialled: dialled ? this.connected / dialled : 0,
        dialsPerConnectedCall: this.connected ? this.attempts / this.connected : 0,
        dialsPerReachedAccount: reached ? this.attempts / reached : 0,
        distribution: INTENSITY_ORDER.filter((b) => this.intensity.get(b)).map((b) => {
          const d = this.intensity.get(b);
          return {
            band: b, accounts: d.accounts, attempts: d.attempts, resolved: d.resolved,
            sharePct: N ? d.accounts / N * 100 : 0,
            resolutionPct: d.accounts ? d.resolved / d.accounts * 100 : 0,
            thin: d.accounts > 0 && d.accounts < CELL_MIN,
          };
        }),
        contactDistribution: CONTACT_ORDER.filter((b) => this.contact.get(b)).map((b) => {
          const d = this.contact.get(b);
          return {
            band: b, accounts: d.accounts, resolved: d.resolved,
            sharePct: N ? d.accounts / N * 100 : 0,
            resolutionPct: d.accounts ? d.resolved / d.accounts * 100 : 0,
            thin: d.accounts > 0 && d.accounts < CELL_MIN,
          };
        }),
      },

      rates: {
        attemptPct: this.attempts ? this.connected / this.attempts * 100 : 0,
        attemptNumerator: this.connected,
        attemptDenominator: this.attempts,
        contactPct: N ? reached / N * 100 : 0,
        contactNumerator: reached,
        contactDenominator: N,

        humanContactPct: N ? this.humanReached / N * 100 : 0,
        humanReached: this.humanReached,
        voicemailCalls: this.vmCalls,
        voicemailPctOfConnected: this.connected ? this.vmCalls / this.connected * 100 : 0,
        humanConnected,
        voicemailMinutes: this.vmSecs / 60,
        talkMinutes: this.secs / 60,
        humanTalkMinutes: Math.max(0, this.secs - this.vmSecs) / 60,
      },

      ptp: {
        accounts: this.ptpAcc,
        resolved: this.ptpRes,
        resolutionPct: this.ptpAcc ? this.ptpRes / this.ptpAcc * 100 : 0,
        outstanding: this.ptpOut,
        recovered: this.ptpRec,
        recoveryPct: this.ptpOut ? this.ptpRec / this.ptpOut * 100 : 0,
        openAmount: this.ptpOut - this.ptpRec,
        sharePct: N ? this.ptpAcc / N * 100 : 0,
        shareOfReachedPct: reached ? this.ptpAcc / reached * 100 : 0,
        baseResolutionPct: baseRatePct,
        liftPts: this.ptpAcc ? (this.ptpRes / this.ptpAcc * 100) - baseRatePct : 0,
        thin: this.ptpAcc > 0 && this.ptpAcc < CELL_MIN,
      },

      complaints: {
        accounts: this.cmpAcc,
        ratePct: N ? this.cmpAcc / N * 100 : 0,
        ofReachedPct: reached ? this.cmpAcc / reached * 100 : 0,
        resolved: this.cmpRes,
        resolutionPct: this.cmpAcc ? this.cmpRes / this.cmpAcc * 100 : 0,
        outstanding: this.cmpOut,
        alsoDnc: this.dncCmp,
      },

      dnc: {
        accounts: this.dncAcc,
        ratePct: N ? this.dncAcc / N * 100 : 0,
        resolved: this.dncRes,
        redialledAccounts: this.dncRedial,
        redialledPct: this.dncAcc ? this.dncRedial / this.dncAcc * 100 : 0,
        redialledDials: this.dncRedialDials,
        maxDialsAfter: this.dncMaxAfter,
        alsoComplaint: this.dncCmp,
        refusedAccounts: this.refAcc,
        refusedResolved: this.refRes,
      },

      lines: [...this.line.entries()]
        .map(([line, v]) => ({
          line, attempts: v.attempts, connected: v.connected,
          connectPct: v.attempts ? v.connected / v.attempts * 100 : 0,
          sharePct: this.attempts ? v.attempts / this.attempts * 100 : 0,
        }))
        .sort((a, b) => b.attempts - a.attempts),

      notMeasured: Aggregator.NOT_MEASURED,
    };
  }

  payload(reportDateDisplay, sources = null) {
    const N = this.N, resolved = this.res, unres = N - resolved;

    const outcomeWindow = this._outcomeWindow();
    const BLIND = outcomeWindow.blind || [];
    const totals = {
      accounts: N, resolved, unresolved: unres, sumOut: this.sumOut, recovered: this.recovered,
      outstandingPending: this.sumOut - this.recovered,
      recoveryRatePct: this.sumOut ? this.recovered / this.sumOut * 100 : 0,
      resolutionRatePct: N ? resolved / N * 100 : 0,
      sumMinDue: this.sumMinDue, avgOutstanding: N ? this.sumOut / N : 0,
      avgRecoveryPerResolved: resolved ? this.recovered / resolved : 0,

      statesCovered: [...this.state.keys()].filter((s) => s !== 'Unspecified').length,
      statesUnspecified: this.state.get('Unspecified')?.count || 0,
    };
    const ai = {
      attempts: this.attempts, connected: this.connected, notConnected: this.attempts - this.connected,

      connectRatePct: Math.max(this.attempts, this.connected)
        ? this.connected / Math.max(this.attempts, this.connected) * 100 : 0,
      talkMinutes: this.secs / 60,
      avgAttempts: N ? this.attempts / N : 0, avgConnectedSec: this.connected ? this.secs / this.connected : 0,
    };

    const leadsConnected = this.fConnected;
    const leadsNotConnected = N - this.fConnected;
    const resolvedConnected = this.rConnected;
    const resolvedNotConnected = resolved - this.rConnected;
    const aiReach = {
      totalLeads: N,
      leadsAttempted: this.fAttempted,
      leadsConnected,
      leadsNotConnected,

      connectionRatePct: N ? leadsConnected / N * 100 : 0,

      connectionRateOfAttemptedPct: this.fAttempted ? leadsConnected / this.fAttempted * 100 : 0,
      neverAttempted: N - this.fAttempted,

      callAttempts: this.attempts,
      callsConnected: this.connected,
      callConnectRatePct: ai.connectRatePct,
      avgAttemptsPerLead: N ? this.attempts / N : 0,
      avgAttemptsToConnect: leadsConnected ? this.attempts / leadsConnected : 0,

      resolvedConnected,
      resolvedNotConnected,
      resolutionConnectedPct: leadsConnected ? resolvedConnected / leadsConnected * 100 : 0,
      resolutionNotConnectedPct: leadsNotConnected ? resolvedNotConnected / leadsNotConnected * 100 : 0,
    };
    const dispositionL2 = [...this.dispL2.entries()]
      .map(([name, v]) => ({
        name, ...v,
        resolutionPct: v.total ? v.resolved / v.total * 100 : 0,
        recoveryPct: v.outstanding ? v.recovered / v.outstanding * 100 : 0,
      }))
      .sort((a, b) => b.recovered - a.recovered);

    const disposition = [...this.disp.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.recovered - a.recovered);

    const seenBands = [...this.band.keys()];
    const bandOrder = [
      ...BAND_ORDER.filter((b) => this.band.has(b)),
      ...seenBands.filter((b) => !BAND_ORDER.includes(b)).sort(),
    ];
    const band = {};
    for (const b of bandOrder) {
      const d = this.band.get(b);
      band[b] = { ...d, resolutionPct: d.count ? d.resolved / d.count * 100 : 0 };
    }
    const unknownBands = seenBands.filter((b) => !BAND_ORDER.includes(b));

    const segments = [...this.seg.entries()]
      .map(([name, v]) => ({
        name, ...v,
        resolutionPct: v.count ? v.resolved / v.count * 100 : 0,
        recoveryPct: v.outstanding ? v.recovered / v.outstanding * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
    const geoOut = (map) => { const o = {}; for (const [k, e] of map) o[k] = { ...e, resolutionPct: e.count ? e.resolved / e.count * 100 : 0, connectPct: e.attempts ? e.connected / e.attempts * 100 : 0 }; return o; };
    const region = geoOut(this.region);

    const cycleBucket = geoOut(this.cycleBucket);
    const language = geoOut(this.language);
    const bucketRegion = Object.entries(geoOut(this.bucketRegion)).map(([k, v]) => {
      const [cycleBucketName, regionName] = k.split('|');
      return { key: k, cycleBucket: cycleBucketName, region: regionName, ...v };
    }).sort((a, b) => b.outstanding - a.outstanding);
    const state = Object.entries(geoOut(this.state)).map(([s, v]) => ({ state: s, ...v })).sort((a, b) => b.outstanding - a.outstanding);

    const duration = DUR_ORDER.filter((b) => this.dur.get(b)).map((b) => {
      const d = this.dur.get(b);
      const m = netOf(d, d.byDate, BLIND, ['n', 'res', 'ptp', 'paid', 'ref']);
      return {
        bucket: b, n: m.n, nAll: d.n, excluded: d.n - m.n,
        thin: m.n > 0 && m.n < CELL_MIN,
        resolutionPct: m.n ? m.res / m.n * 100 : 0,
        ptpPct: m.n ? m.ptp / m.n * 100 : 0,
        paidPct: m.n ? m.paid / m.n * 100 : 0,
        refusalPct: m.n ? m.ref / m.n * 100 : 0,
      };
    }).filter((d) => d.n > 0);

    const L2_MIN = 20;
    const durL2Net = [...this.durL2.entries()]
      .map(([name, v]) => [name, v, netOf(v, v.byDate, BLIND, ['n', 'res', 'secs', 'recovered'])]);
    const durationByL2 = durL2Net
      .filter(([, , m]) => m.n >= L2_MIN)
      .map(([name, v, m]) => ({
        name,
        n: m.n,
        nAll: v.n,
        excluded: v.n - m.n,
        resolutionPct: m.n ? m.res / m.n * 100 : 0,
        avgSeconds: m.n ? m.secs / m.n : 0,
        recovered: m.recovered,
        buckets: DUR_ORDER.map((b) => {
          const d = v.buckets.get(b);
          if (!d) return { bucket: b, n: 0, resolutionPct: null };
          const c = netOf(d, d.byDate, BLIND, ['n', 'res']);
          return { bucket: b, n: c.n, resolutionPct: c.n ? c.res / c.n * 100 : null };
        }),
      }))
      .sort((a, b) => b.n - a.n);

    const l2BelowThreshold = durL2Net.filter(([, , m]) => m.n < L2_MIN).reduce((a, [, , m]) => a + m.n, 0);

    const paymentModes = [...this.pm.entries()].map(([mode, v]) => ({ mode, ...v })).sort((a, b) => b.amount - a.amount);

    const stage = (n, label, value, res, kind, note) => ({
      n, stage: label, value, resolved: res,
      pctOfBook: N ? value / N * 100 : 0,
      resolutionPct: value ? res / value * 100 : 0,
      kind, note,
    });
    const funnel = [
      stage(1, 'Total Accounts', N, resolved, 'journey', 'Every account in RBL\'s CYC book'),

      stage(2, 'Total Leads Attempted', this.fAttempted, this.rAttempted, 'journey', 'The AI dialled these'),

      stage(3, 'Total Leads Connected', this.fConnected, this.rConnected, 'journey', 'The call was answered — includes voicemail; see the contact-rate card for the human-only split'),
      stage(4, 'Promise to Pay Later', this.fPtpLater, this.rPtpLater, 'outcome', 'Disposition L2 — the customer committed to pay later'),
      stage(5, 'Paid', this.fPaidL2, this.rPaidL2, 'outcome', 'Disposition L2 — the customer said the payment was made'),
      stage(6, 'Resolved Customers', resolved, resolved, 'outcome', 'RBL\'s own status file — the only outcome we did not write'),
    ];

    const topOutstanding = this.top.map((t) => ({ ref: t.ref, outstanding: t.o, state: t.state, connected: t.connected, ptp: t.ptp, status: t.status }));

    const baseRate = N ? resolved / N : 0;
    const cuts = tierCuts(baseRate);

    const callLog = this._callSection(N, resolved, baseRate * 100);

    const cohorts = [...this.agency.entries()]
      .map(([name, v]) => ({
        name, ...v,
        resolutionPct: v.count ? v.resolved / v.count * 100 : 0,
        recoveryPct: v.outstanding ? v.recovered / v.outstanding * 100 : 0,
        connectPct: v.attempts ? v.connected / v.attempts * 100 : 0,
        avgAttempts: v.count ? v.attempts / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const spec = buildCategoricalSpec(this.cats);
    const XF = spec.length ? this.X.map((x, i) => [...x, ...encodeCategorical(this.cats[i], spec)]) : this.X;
    const openXF = spec.length ? this.openX.map((x, i) => [...x, ...encodeCategorical(this.openCats[i], spec)]) : this.openX;
    const featNames = featureNamesWith(spec);

    const fitted = trainPropensity(XF, this.Y, featNames);
    if (fitted) {
      for (let i = 0; i < openXF.length; i++) {
        const p = score(fitted.model, openXF[i]);
        const tier = p >= cuts.high ? 'High' : p >= cuts.medium ? 'Medium' : 'Low';
        this.tiers[tier].count++;
        this.tiers[tier].amount += this.openAmt[i];
      }
    }

    const lifts = XF.length ? computeLifts(XF, this.Y, 30, featNames).slice(0, 6) : [];
    const model = fitted
      ? {
        name: MODEL_NAME,
        version: MODEL_VERSION,
        trained: true,
        auc: fitted.auc,
        trainedOn: fitted.trainedOn,
        testedOn: fitted.testedOn,
        lifts,

        features: featNames.length,
        discovered: spec.map((c) => ({ field: c.field, value: c.value, name: c.name, n: c.n })),
        thresholds: { high: cuts.high, medium: cuts.medium, baseRate },
        method: `${MODEL_NAME} v${MODEL_VERSION} — a regularised logistic regression refitted on this report, with 20% of accounts held back to measure the AUC out-of-sample. Tier cut-offs come from this book's own base recovery rate, not a preset.`,
      }
      : {
        name: MODEL_NAME,
        version: MODEL_VERSION,
        trained: false,
        auc: null,
        lifts,
        method: `Not enough resolved/unresolved accounts in this report for ${MODEL_NAME} to fit.`,
      };

    const agencyCost = this.recovered * AGENCY_PCT / 100;
    const roi = {
      agencyPct: AGENCY_PCT,
      agencyCostInr: agencyCost,
      projectedAnnualRecovery: this.recovered * CYCLES_PER_YEAR * CYCLE_DECAY,
      assumptions: { agencyPct: AGENCY_PCT, cyclesPerYear: CYCLES_PER_YEAR, cycleDecay: CYCLE_DECAY },
    };

    const opportunity = { openOutstanding: this.openOut, ranked: !!fitted, tiers: this.tiers, lists: [
      { label: 'Promised to pay — still open', note: 'Broken-promise follow-ups', ...this.oppPromise },
      { label: 'Engaged ≥2 min — not closed', note: 'Highest propensity', ...this.oppEngaged },
      { label: 'Claimed paid — unresolved', note: 'Reconciliation / verification', ...this.oppClaimed },
    ] };
    const entityTruth = { alreadyPaidReliabilityPct: this.paidYes ? this.paidYesRes / this.paidYes * 100 : 0, saidNoButResolved: this.saidNoRes, promisedButOpen: this.promisedOpen };

    const dial = ATT_ORDER.filter((b) => this.dial.get(b)).map((b) => {
      const d = this.dial.get(b);
      const m = netOf(d, d.byDate, BLIND, ['n', 'connect', 'resolved']);
      return {
        band: b, n: m.n, nAll: d.n, excluded: d.n - m.n,
        thin: m.n > 0 && m.n < CELL_MIN,
        connectPct: m.n ? m.connect / m.n * 100 : 0,
        resolutionPct: m.n ? m.resolved / m.n * 100 : 0,
      };
    }).filter((d) => d.n > 0);

    const liftOf = (name) => {
      const l = model.lifts.find((x) => x.name === name);
      return l ? l.liftPts : null;
    };
    const MATERIAL = 5;

    const longBuckets = duration.filter((d) => d.bucket === '2–5 min' || d.bucket === '>5 min');
    const longN = longBuckets.reduce((a, d) => a + d.n, 0);
    const longRes = longN ? longBuckets.reduce((a, d) => a + d.resolutionPct * d.n, 0) / longN : 0;
    const baseRatePct = baseRate * 100;

    const STRONG = 12;
    const talkLift = liftOf('Talked 2+ minutes');
    const talkSentence = talkLift === null || longN === 0 ? ''
      : talkLift >= STRONG
        ? ` Conversation length is doing the work: accounts talked past two minutes resolved ${longRes.toFixed(0)}% of the time, against ${baseRatePct.toFixed(0)}% for the book.`
        : talkLift >= MATERIAL
          ? ` Longer conversations help, modestly: ${longRes.toFixed(0)}% past two minutes against ${baseRatePct.toFixed(0)}% for the book.`
          : talkLift <= -MATERIAL
            ? ` Notably, longer conversations did NOT convert on this book (${longRes.toFixed(0)}% past two minutes, below the ${baseRatePct.toFixed(0)}% book average) — worth investigating.`
            : ` Conversation length made little difference on this book (${longRes.toFixed(0)}% past two minutes vs ${baseRatePct.toFixed(0)}% overall).`;

    const promiseLift = liftOf('Promised to pay');
    const promiseSentence = this.oppPromise.amount <= 0 || promiseLift === null ? ''
      : promiseLift <= -MATERIAL
        ? ` ${cr(this.oppPromise.amount)} sits with customers who promised to pay — but on this book a promise is a *worse* signal than silence (${(baseRatePct + promiseLift).toFixed(0)}% resolved vs ${baseRatePct.toFixed(0)}% overall), so it should not be worked first.`
        : promiseLift >= MATERIAL
          ? ` ${cr(this.oppPromise.amount)} sits with customers who promised to pay, and on this book that promise holds (${(baseRatePct + promiseLift).toFixed(0)}% resolved vs ${baseRatePct.toFixed(0)}% overall) — work it first.`
          : ` ${cr(this.oppPromise.amount)} sits with customers who promised to pay, though a promise carries little signal on this book.`;

    const engagedSentence = this.oppEngaged.amount > 0
      ? ` ${cr(this.oppEngaged.amount)} sits with accounts the AI genuinely engaged.` : '';

    const dealCase =
      `Convin's AI worked ${N.toLocaleString('en-IN')} RBL accounts carrying ${cr(this.sumOut)} in outstanding and recovered ${cr(this.recovered)} — ${totals.recoveryRatePct.toFixed(1)}% of the book — by resolving ${resolved.toLocaleString('en-IN')} accounts. `
      + `It placed ${this.attempts.toLocaleString('en-IN')} calls, and its 'already-paid' read matched the true outcome ${entityTruth.alreadyPaidReliabilityPct.toFixed(0)}% of the time.`
      + talkSentence
      + ` ${cr(this.openOut)} remains open.`
      + promiseSentence
      + engagedSentence
      + (model.trained ? ` ${model.name} has ranked every open account by how likely it is to pay.` : '')
      + ` A recovery agency would have billed roughly ${cr(agencyCost)} in commission for the same result.`;

    return {
      version: PAYLOAD_VERSION,

      meta: {
        reportDate: reportDateDisplay,
        accounts: N,
        source: 'Convin AI Collections — RBL Bank',

        hasBucketColumn: this.hasCycleBucketColumn,
        cycFile: (sources || []).find((s) => s.detected === 'cyc')?.name
          || (sources || []).find((s) => /primary/i.test(s.slot || ''))?.name || '',
        sources: sources || [],
      },
      agg: { totals, ai, aiReach, entity: this.entity, disposition, dispositionL2, band, bandOrder, segments, cohorts, region, state, cycleBucket, language, bucketRegion, outcomeOrder: OUTCOME_ORDER, duration, durationOrder: DUR_ORDER, durationByL2, l2BelowThreshold, l2Min: L2_MIN, paymentModes, funnel, topOutstanding, outcomeWindow, callLog },

      quality: {
        unknownBands,
        dirtyAttemptRows: this.dirtyAttempts,
        modelFitted: !!fitted,
      },
      intel: { dealCase, roi, opportunity, entityTruth, dial, model },
    };
  }
}
