export const BAND_ORDER = ['<20K', '20-30K', '30-50K', '50-70K', '70-100K', '100-200K', '>200K'];

export const num = (x) => {
  const n = parseFloat(String(x ?? '').replace(/[, ₹]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const U = (x) => String(x ?? '').trim().toUpperCase();

export const dateOnly = (v) => {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  return '';
};

export const bandNorm = (b) => String(b ?? '').trim().toUpperCase().replace(/\s/g, '');

export const canonHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const entityNorm = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return 'Blank';
  if (s.toUpperCase() === 'NA') return 'N/A';
  if (s.toUpperCase() === 'YES') return 'YES';
  if (s.toUpperCase() === 'NO') return 'NO';
  return s;
};
export const refusalBucket = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return 'Blank';
  if (s.toUpperCase() === 'NA') return 'N/A';
  if (s.toUpperCase() === 'NO') return 'NO';
  return 'YES';
};
export const payBucket = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '' || s === 'na') return null;
  if (s.includes('phonepe')) return 'PhonePe';
  if (s.includes('gpay') || s.includes('google') || s.includes('g pay')) return 'Google Pay';
  if (s.includes('paytm')) return 'Paytm';
  if (s.includes('rbl')) return 'RBL App';
  if (s.includes('upi')) return 'UPI';
  if (s.includes('neft') || s.includes('imps') || s.includes('net') || s.includes('online') || s.includes('netbank')) return 'Net/Online';
  if (s.includes('credit card') || s.includes('debit') || s.includes('card')) return 'Card';
  if (s.includes('app')) return 'RBL App';
  if (s.includes('phone') || s.includes('call')) return 'Net/Online';
  return 'Other';
};

export const ALIASES = {
  account_no: ['account_number', 'Account No', 'Account Number', 'account_no', 'Acct No', 'ACCOUNT NO', 'External ID'],
  customer_name: ['Customer Name', 'CUSTOMER NAME', 'Full Name', 'Name'],

  status: ['status', 'Status', 'Lead Status'],
  goal_achieved: ['Goal Achieved'],
  qual_status: ['Qualification Status'],
  disp_l1: ['CollectionsDisposition_v2 L1', 'Disposition L1'],
  disp_l2: ['CollectionsDisposition_v2 L2', 'Disposition L2'],
  ai_attempts: ['Total AI Call Attempts', 'AI Call Attempts'],
  ai_connected_calls: ['AI Connected Calls'],
  ai_connected_seconds: ['AI Connected Seconds'],

  minimum_amount_due: ['minimum_amount_due', 'Minimum Amount Due', 'Min Amount Due'],
  total_outstanding: ['total_outstanding', 'Total Outstanding', 'Current Balance'],
  total_accounts_with_customer: ['Total Accounts with customer', 'Total Accounts with Customer'],
  months_on_book: ['Months on Book', 'MOB'],
  curr_bal_band: ['Curr Bal Band', 'Balance Band'],
  region: ['Region'],

  cycle_bucket: ['Bucket'],
  primary_state: ['Primary State', 'pm_state', 'State'],
  primary_city: ['Primary City', 'pm_city', 'City'],
  mobile: ['Mobile Number -1', 'Mobile Number', 'Mobile', 'Phone'],
  model_logic: ['As Per New Logic M2', 'As Per New Logic'],
  paid_flag: ['Lead Entity Paid'],
  promise_flag: ['Lead Entity Promise to Pay'],
  refusal_flag: ['Lead Entity Refusal to pay', 'Lead Entity Refusal to Pay'],
  payment_mode_raw: ["Lead Entity If payment done return 'Mode of Payment", 'Mode of Payment', 'Last payment mode'],
  lead_link: ['Lead Link'],

  last_call_at: ['Last Call Timestamp', 'Last Call Time', 'Last Call Date', 'Last Interaction Time'],

  segment: ['Segment', 'SEGMENT', 'Portfolio(PDD)'],

  ai_agency: ['AI Agency', 'AI_Agency', 'Agency'],

  lead_score: ['Lead Metric Collection Score', 'Lead Metric Collection Store', 'Collection Score'],
};

export const CRITICAL = ['account_no', 'status', 'total_outstanding'];

export const FIELD_LABELS = {
  account_no: 'Account No', status: 'Status', total_outstanding: 'Total Outstanding',
  customer_name: 'Customer Name', minimum_amount_due: 'Minimum Due', curr_bal_band: 'Balance Band',
  region: 'Region', primary_state: 'State', primary_city: 'City', mobile: 'Mobile',
  months_on_book: 'Months on Book', total_accounts_with_customer: 'Accounts with Customer',
  model_logic: 'Model / Strategy', ai_attempts: 'AI Call Attempts', ai_connected_calls: 'AI Connected Calls',
  ai_connected_seconds: 'AI Connected Seconds',
  disp_l1: 'Disposition L1', disp_l2: 'Disposition L2',
  qual_status: 'Qualification Status', goal_achieved: 'Goal Achieved', paid_flag: 'Entity · Already Paid',
  promise_flag: 'Entity · Promise to Pay', refusal_flag: 'Entity · Refusal to Pay',
  payment_mode_raw: 'Mode of Payment', lead_link: 'Lead Link',
  segment: 'Segment (RBL)', lead_score: 'Lead Collection Score',
  last_call_at: 'Last Call Timestamp', ai_agency: 'AI Agency',
};

export const FIELD_GROUPS = [
  { title: 'Required', keys: ['account_no', 'status', 'total_outstanding'] },
  { title: 'Money & customer', keys: ['customer_name', 'minimum_amount_due', 'curr_bal_band', 'months_on_book', 'total_accounts_with_customer', 'segment', 'ai_agency'] },
  { title: 'Geography', keys: ['region', 'primary_state', 'primary_city', 'mobile'] },
  { title: 'AI calling', keys: ['ai_attempts', 'ai_connected_calls', 'ai_connected_seconds', 'last_call_at', 'lead_score'] },
  { title: 'Outcomes & entities', keys: ['disp_l1', 'disp_l2', 'qual_status', 'goal_achieved', 'paid_flag', 'promise_flag', 'refusal_flag', 'payment_mode_raw'] },
  { title: 'Other', keys: ['model_logic', 'lead_link'] },
];

const SCI = /^\d+(\.\d+)?[eE][+-]?\d+$/;
export const isCorruptAccount = (v) => SCI.test(String(v ?? '').trim());

export function normalizeAccount(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';

  const bare = s.replace(/[\s -]/g, '');
  if (/^\d+$/.test(bare)) return bare;

  if (SCI.test(s)) return s;

  const runs = s.match(/\d{8,}/g);
  if (runs && runs.length) return runs.reduce((a, b) => (b.length > a.length ? b : a));

  return s;
}

export function decodesTo(candidate, corrupt) {
  const m = String(corrupt ?? '').trim().match(/^(\d)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (!m) return false;
  const decimals = (m[2] || '').length;
  const digits = String(candidate ?? '').replace(/\D/g, '');
  if (!digits) return false;
  const n = Number(digits);
  if (!Number.isFinite(n) || n === 0) return false;
  return n.toExponential(decimals).toUpperCase() === String(corrupt).trim().toUpperCase();
}

export function accountKey(rec, mapping) {
  const canonIdx = new Map();
  for (const col of Object.keys(rec)) { const k = canonHeader(col); if (k && !canonIdx.has(k)) canonIdx.set(k, col); }
  const names = [];
  const add = (name) => { const col = name != null && canonIdx.get(canonHeader(name)); if (col && !names.includes(col)) names.push(col); };
  if (mapping && mapping.account_no) add(mapping.account_no);
  for (const n of ALIASES.account_no) add(n);

  let corrupt = '';
  let corruptCol = '';
  const cleanFromAlias = [];

  for (const n of names) {
    const raw = rec[n];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = normalizeAccount(raw);
    if (!v) continue;
    if (isCorruptAccount(v)) { if (!corrupt) { corrupt = v; corruptCol = n; } continue; }
    cleanFromAlias.push({ v, n });
  }

  if (!corrupt) {
    const first = cleanFromAlias[0];
    return first
      ? { key: first.v, from: first.n, recovered: false, verified: true, corrupt: false }
      : { key: '', from: '', recovered: false, verified: true, corrupt: false };
  }

  for (const { v, n } of cleanFromAlias) {
    if (decodesTo(v, corrupt)) return { key: v, from: n, recovered: true, verified: true, corrupt: false };
  }

  for (const [col, raw] of Object.entries(rec)) {
    if (names.includes(col)) continue;
    const v = normalizeAccount(raw);
    if (!v || isCorruptAccount(v) || !/^\d{8,}$/.test(v)) continue;
    if (decodesTo(v, corrupt)) return { key: v, from: col, recovered: true, verified: true, corrupt: false };
  }

  if (cleanFromAlias.length) {
    const { v, n } = cleanFromAlias[0];
    return { key: v, from: n, recovered: true, verified: false, corrupt: false };
  }

  return { key: corrupt, from: corruptCol, recovered: false, verified: false, corrupt: true };
}

export function getField(rec, key, mapping) {
  if (key === 'account_no') return accountKey(rec, mapping).key;
  if (mapping && mapping[key]) {
    const v = rec[mapping[key]];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  const names = ALIASES[key] || [];
  for (const n of names) {
    const v = rec[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }

  const own = rec[key];
  if (own !== undefined && own !== null && String(own).trim() !== '') return own;
  return '';
}

export function autoMap(headers) {
  const canon = new Map();
  for (const h of headers) { const k = canonHeader(h); if (k && !canon.has(k)) canon.set(k, String(h ?? '').trim()); }
  const out = {};
  for (const key of Object.keys(ALIASES)) {
    for (const alias of (ALIASES[key] || [])) {
      const hit = canon.get(canonHeader(alias));
      if (hit) { out[key] = hit; break; }
    }
  }
  return out;
}

export function missingCritical(rec, mapping) {
  return CRITICAL.filter((k) => String(getField(rec, k, mapping)).trim() === '');
}

const CALL_DEFAULTS = {
  first_call_at: '',
  attempts_by_hour: '',
  outbound_lines: '',
  attempt_mask: '',
  max_attempt: 0,
  attempt_first_paid: 0,
  dnc_attempt: 0,
  dials_after_dnc: 0,
  voicemail_calls: 0,
  voicemail_seconds: 0,
  complaint_flag: false,
  dnc_flag: false,
  refused_flag: false,
  ptp_flag: false,
};

function hasCycleBucketColumn(rec, mapping) {
  if (mapping && mapping.cycle_bucket) return true;
  if (rec && Object.prototype.hasOwnProperty.call(rec, 'cycle_bucket') && rec.cycle_bucket !== null) return true;
  return (ALIASES.cycle_bucket || []).some((a) => rec && Object.prototype.hasOwnProperty.call(rec, a));
}

export function normalizeMap(rec, mapping) {
  const g = (k) => getField(rec, k, mapping);
  const refusalRaw = String(g('refusal_flag')).trim();
  return {
    account_no: String(g('account_no')).trim(),
    customer_name: String(g('customer_name')).trim() || '—',
    status: String(g('status')).trim(),
    goal_achieved: String(g('goal_achieved')).trim(),
    qual_status: String(g('qual_status')).trim(),
    disp_l1: String(g('disp_l1')).trim(),
    disp_l2: String(g('disp_l2')).trim(),
    ai_attempts: Math.round(num(g('ai_attempts'))),
    ai_connected_calls: Math.round(num(g('ai_connected_calls'))),
    ai_connected_seconds: Math.round(num(g('ai_connected_seconds'))),
    minimum_amount_due: num(g('minimum_amount_due')),
    total_outstanding: num(g('total_outstanding')),
    total_accounts_with_customer: Math.round(num(g('total_accounts_with_customer'))),
    months_on_book: Math.round(num(g('months_on_book'))),
    curr_bal_band: bandNorm(g('curr_bal_band')),
    region: String(g('region')).trim(),

    cycle_bucket: hasCycleBucketColumn(rec, mapping) ? cycleBucketNorm(g('cycle_bucket')) : null,
    primary_state: String(g('primary_state')).trim(),
    primary_city: String(g('primary_city')).trim(),
    mobile: String(g('mobile')).trim(),
    model_logic: String(g('model_logic')).trim(),
    paid_flag: entityNorm(g('paid_flag')),
    promise_flag: entityNorm(g('promise_flag')),
    refusal_flag: refusalBucket(refusalRaw),
    refusal_reason: refusalRaw && U(refusalRaw) !== 'NA' ? refusalRaw : '',
    payment_mode: payBucket(g('payment_mode_raw')) || 'NA',
    lead_link: String(g('lead_link')).trim(),

    last_call_at: dateOnly(g('last_call_at')),

    segment: String(g('segment')).trim(),

    lead_score: String(g('lead_score')).trim(),

    ai_agency: String(g('ai_agency')).trim(),

    ...CALL_DEFAULTS,
  };
}

export const RESOLVED_STATUSES = new Set(['resolved', 'normalisation', 'normalization', 'stab', 'rb']);
export const isResolved = (r) => RESOLVED_STATUSES.has(String(r.status ?? '').trim().toLowerCase());

const OUTCOME_LABELS = {
  resolved: 'Resolved',
  normalisation: 'Normalisation',
  normalization: 'Normalisation',
  stab: 'STAB',
  rb: 'RB',
  unresolved: 'Unresolved',
};
export const outcomeLabel = (r) => {
  const s = String(r?.status ?? '').trim();
  if (!s) return 'Unspecified';
  return OUTCOME_LABELS[s.toLowerCase()] || s;
};

export const OUTCOME_ORDER = ['Unresolved', 'RB', 'STAB', 'Normalisation', 'Resolved', 'Unspecified'];

export const cycleBucketNorm = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = s.match(/^[Bb]?\s*(\d+)$/);
  return m ? m[1] : s;
};

const STATE_LANGUAGE = {
  kerala: 'Malayalam',
  'andhra pradesh': 'Telugu',
  'tamil nadu': 'Tamil',
  pondicherry: 'Tamil',
  karnataka: 'Kannada',
  telangana: 'Telugu',
};
export const languageOf = (state) => {
  const s = String(state ?? '').trim();
  if (!s) return 'Unspecified';
  return STATE_LANGUAGE[s.toLowerCase()] || 'Others';
};
