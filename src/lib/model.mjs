export const MODEL_NAME = 'RoshRegression';
export const MODEL_VERSION = '1.0';

const U = (x) => String(x ?? '').trim().toUpperCase();

const FEATURES = [
  ['Connected on a call', (r) => (r.ai_connected_calls > 0 ? 1 : 0)],
  ['Talk time (log seconds)', (r) => Math.log1p(r.ai_connected_seconds)],
  ['Talked 2+ minutes', (r) => (r.ai_connected_seconds >= 120 ? 1 : 0)],
  ['Number of call attempts', (r) => r.ai_attempts],
  ['Promised to pay', (r) => (U(r.promise_flag) === 'YES' ? 1 : 0)],
  ['Claimed already paid', (r) => (U(r.paid_flag) === 'YES' ? 1 : 0)],
  ['Refused to pay', (r) => (r.refusal_flag === 'YES' ? 1 : 0)],
  ['Qualified lead', (r) => (r.qual_status === 'Qualified' ? 1 : 0)],
  ['Disposition: Paid', (r) => (r.disp_l1 === 'Paid' ? 1 : 0)],
  ['Disposition: Callback', (r) => (r.disp_l1 === 'Schedule Callback' ? 1 : 0)],
  ['Disposition: DNC', (r) => (r.disp_l1 === 'DNC' ? 1 : 0)],
  ['Outstanding (log ₹)', (r) => Math.log1p(Math.max(0, r.total_outstanding))],
  ['Months on book', (r) => r.months_on_book],
  ['Holds 2+ accounts', (r) => (r.total_accounts_with_customer > 1 ? 1 : 0)],

];

export const FEATURE_NAMES = FEATURES.map(([n]) => n);
export const featurize = (r) => FEATURES.map(([, f]) => {
  const v = f(r);
  return Number.isFinite(v) ? v : 0;
});

const CATEGORICALS = [
  { field: 'segment', label: (v) => `RBL segment: ${v}` },
  { field: 'lead_score', label: (v) => `Our score: ${v}` },
];

const title = (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase();

export function buildCategoricalSpec(rows, minN = 30) {
  const cols = [];
  for (const { field, label } of CATEGORICALS) {
    const counts = new Map();
    for (const r of rows) {
      const v = U(r[field]);
      if (!v || v === 'NA' || v === 'N/A') continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size < 2) continue;

    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [value, n] of ordered.slice(1)) {
      if (n < minN || n === rows.length) continue;
      cols.push({ field, value, name: label(title(value)), n });
    }
  }
  return cols;
}

export const encodeCategorical = (r, spec) => spec.map((c) => (U(r[c.field]) === c.value ? 1 : 0));

export const featurizeWith = (r, spec) => [...featurize(r), ...encodeCategorical(r, spec)];
export const featureNamesWith = (spec) => [...FEATURE_NAMES, ...spec.map((c) => c.name)];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function fit(X, y, { epochs = 400, lr = 0.5, l2 = 1e-3 } = {}) {
  const n = X.length, d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const r of X) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / n) || 1;

  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  const w = new Array(d).fill(0);
  let b = 0;

  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b, mean, std };
}

export function score(model, x) {
  let z = model.b;
  for (let j = 0; j < x.length; j++) z += model.w[j] * ((x[j] - model.mean[j]) / model.std[j]);
  return sigmoid(z);
}

function auc(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rankSumPos = 0, nPos = 0, nNeg = 0, i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      if (pairs[k][1] === 1) { rankSumPos += avgRank; nPos++; } else nNeg++;
    }
    i = j;
  }
  if (!nPos || !nNeg) return null;
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function computeLifts(X, y, minN = 30, names = FEATURE_NAMES) {
  const n = X.length, d = X[0].length;
  const base = y.reduce((a, b) => a + b, 0) / n;
  const out = [];
  for (let j = 0; j < d; j++) {
    let binary = true;
    for (let i = 0; i < n; i++) { const v = X[i][j]; if (v !== 0 && v !== 1) { binary = false; break; } }
    if (!binary) continue;
    let cnt = 0, res = 0;
    for (let i = 0; i < n; i++) if (X[i][j] === 1) { cnt++; res += y[i]; }
    if (cnt < minN) continue;

    if (cnt === n) continue;

    const rate = res / cnt;
    out.push({ name: names[j], n: cnt, ratePct: rate * 100, basePct: base * 100, liftPts: (rate - base) * 100 });
  }
  return out.sort((a, b) => Math.abs(b.liftPts) - Math.abs(a.liftPts));
}

export function trainPropensity(X, y, names = FEATURE_NAMES) {
  const n = X.length;
  const pos = y.reduce((a, v) => a + v, 0);
  if (n < 60 || pos < 15 || n - pos < 15) return null;

  const trX = [], trY = [], teX = [], teY = [];
  for (let i = 0; i < n; i++) {
    if (i % 5 === 0) { teX.push(X[i]); teY.push(y[i]); } else { trX.push(X[i]); trY.push(y[i]); }
  }
  const model = fit(trX, trY);
  const testAuc = auc(teX.map((x) => score(model, x)), teY);

  const drivers = model.w
    .map((w, j) => ({ name: names[j], weight: w, effect: w >= 0 ? 'up' : 'down' }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return { model, auc: testAuc, drivers, trainedOn: trX.length, testedOn: teX.length };
}
