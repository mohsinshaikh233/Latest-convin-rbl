export const SUMMARY_VERSION = 1;

const pctOf = (a, b) => (b ? (a / b) * 100 : 0);
const round1 = (n) => Math.round(n * 10) / 10;

export function buildTrend(days) {
  return days
    .filter((d) => d.payload?.agg?.totals)
    .map(({ id, label, payload }, i) => {
      const t = payload.agg.totals;
      const ai = payload.agg.ai || {};
      return {
        id,
        label: label || `Day ${i + 1}`,
        cycFile: payload.meta?.cycFile || '',
        accounts: t.accounts,
        outstanding: t.sumOut,
        recovered: t.recovered,
        resolved: t.resolved,
        resolutionPct: t.resolutionRatePct,
        recoveryPct: t.recoveryRatePct,
        attempts: ai.attempts || 0,
        connected: ai.connected || 0,
        talkMinutes: ai.talkMinutes || 0,
        recoveredDelta: 0,
        resolvedDelta: 0,
      };
    })
    .map((d, i, all) => {
      if (i === 0) return { ...d, sameBook: true };
      const prev = all[i - 1];

      const sameBook = !prev.cycFile || !d.cycFile || prev.cycFile === d.cycFile;
      return sameBook
        ? { ...d, recoveredDelta: d.recovered - prev.recovered, resolvedDelta: d.resolved - prev.resolved, sameBook: true }
        : { ...d, sameBook: false };
    });
}

export function buildFindings(campaign) {
  const A = campaign.agg;
  const t = A.totals;
  const base = t.resolutionRatePct;
  const out = [];
  if (!t.accounts) return out;

  const r = A.aiReach;
  if (r?.leadsConnected && r?.leadsNotConnected) {
    const gap = r.resolutionConnectedPct - r.resolutionNotConnectedPct;
    out.push({
      kind: gap > 0 ? 'good' : 'bad',
      label: 'Reaching the customer moves the outcome',
      value: `${gap > 0 ? '+' : ''}${round1(gap)} pts`,
      detail: `Leads the AI reached resolve at ${round1(r.resolutionConnectedPct)}% (${r.resolvedConnected.toLocaleString('en-IN')} of ${r.leadsConnected.toLocaleString('en-IN')}); leads it never reached, ${round1(r.resolutionNotConnectedPct)}%. Not a randomised comparison — read it as the measured gap between reached and unreached customers, not as proof the call caused the payment.`,
    });
  }

  const dur = (A.duration || []).filter((d) => d.bucket !== 'Not connected' && d.n >= 30);
  if (dur.length >= 2) {
    const best = dur.reduce((a, b) => (b.resolutionPct > a.resolutionPct ? b : a));
    const worst = dur.reduce((a, b) => (b.resolutionPct < a.resolutionPct ? b : a));
    out.push({
      kind: 'good',
      label: 'Longer conversations recover more',
      value: `${round1(best.resolutionPct)}%`,
      detail: `Conversations in the ${best.bucket} band resolve at ${round1(best.resolutionPct)}% (n=${best.n.toLocaleString('en-IN')}), against ${round1(worst.resolutionPct)}% at ${worst.bucket} (n=${worst.n.toLocaleString('en-IN')}). Time on the call is the lever, not the number of dials.`,
    });
  }

  const l2 = A.dispositionL2 || [];
  const promise = l2.find((d) => d.name === 'Promise to Pay Later');
  const paid = l2.find((d) => d.name === 'Paid');
  if (promise && promise.total >= 30) {
    const trap = promise.resolutionPct < base;
    out.push({
      kind: trap ? 'bad' : 'good',
      label: trap ? 'A promise to pay is the weakest signal in the book' : 'Promises to pay convert',
      value: `${round1(promise.resolutionPct)}%`,
      detail: trap
        ? `${promise.total.toLocaleString('en-IN')} customers promised to pay later and only ${round1(promise.resolutionPct)}% did — ${round1(base - promise.resolutionPct)} points BELOW the book average of ${round1(base)}%. A promise is not a commitment; treat it as an unresolved account, not a win.`
        : `${promise.total.toLocaleString('en-IN')} customers promised to pay later and ${round1(promise.resolutionPct)}% did, against a book average of ${round1(base)}%. On this book, a promise is worth having.`,
    });
  }
  if (paid && paid.total >= 30) {
    out.push({
      kind: paid.resolutionPct > base ? 'good' : 'bad',
      label: '"Already paid" is the strongest thing a customer says',
      value: `${round1(paid.resolutionPct)}%`,
      detail: `${paid.total.toLocaleString('en-IN')} customers said the payment was already made, and ${round1(paid.resolutionPct)}% of them did resolve — against ${round1(base)}% across the book. The other ${(100 - round1(paid.resolutionPct)).toFixed(1)}% is a reconciliation problem, not a collections one.`,
    });
  }

  const bands = Object.entries(A.band || {}).filter(([, b]) => b.count >= 50);
  if (bands.length >= 2) {
    const bestB = bands.reduce((a, b) => (b[1].resolutionPct > a[1].resolutionPct ? b : a));
    const worstB = bands.reduce((a, b) => (b[1].resolutionPct < a[1].resolutionPct ? b : a));
    if (bestB[0] !== worstB[0]) {
      out.push({
        kind: 'bad',
        label: 'Recovery falls as the balance rises',
        value: `${round1(worstB[1].resolutionPct)}% at ${worstB[0]}`,
        detail: `The ${bestB[0]} band resolves at ${round1(bestB[1].resolutionPct)}% (${bestB[1].count.toLocaleString('en-IN')} accounts); ${worstB[0]} resolves at ${round1(worstB[1].resolutionPct)}% (${worstB[1].count.toLocaleString('en-IN')} accounts). The largest balances are the hardest to close and hold the most money — they need a different treatment, not more dials.`,
      });
    }
  }

  const regions = Object.entries(A.region || {}).filter(([k, v]) => k !== 'Unspecified' && v.count >= 50);
  if (regions.length >= 2) {
    const bestR = regions.reduce((a, b) => (b[1].resolutionPct > a[1].resolutionPct ? b : a));
    const worstR = regions.reduce((a, b) => (b[1].resolutionPct < a[1].resolutionPct ? b : a));
    if (bestR[0] !== worstR[0] && bestR[1].resolutionPct - worstR[1].resolutionPct >= 2) {
      out.push({
        kind: 'good',
        label: `${bestR[0]} is the strongest region`,
        value: `${round1(bestR[1].resolutionPct)}%`,
        detail: `${bestR[0]} resolves at ${round1(bestR[1].resolutionPct)}% across ${bestR[1].count.toLocaleString('en-IN')} accounts; ${worstR[0]} at ${round1(worstR[1].resolutionPct)}%. A ${round1(bestR[1].resolutionPct - worstR[1].resolutionPct)}-point spread on the same script.`,
      });
    }
  }

  if (r?.avgAttemptsToConnect && r?.callAttempts) {
    out.push({
      kind: 'bad',
      label: 'Most dials never reach anyone',
      value: `${round1(pctOf(A.ai.connected, A.ai.attempts))}% connect`,
      detail: `${A.ai.attempts.toLocaleString('en-IN')} dials produced ${A.ai.connected.toLocaleString('en-IN')} connected calls — roughly ${Math.round(r.avgAttemptsToConnect)} dials to reach one customer. ${r.leadsNotConnected.toLocaleString('en-IN')} accounts were never reached at all.`,
    });
  }

  return out;
}

export function buildActions(campaign) {
  const A = campaign.agg;
  const I = campaign.intel;
  const t = A.totals;
  const actions = [];

  for (const b of I?.opportunity?.lists || []) {
    if (!b.count) continue;
    actions.push({ label: b.label, note: b.note, count: b.count, amount: b.amount });
  }

  const top = A.topOutstanding || [];
  if (top.length) {
    const openTop = top.filter((x) => String(x.status || '').toLowerCase() !== 'resolved');
    if (openTop.length) {
      const amt = openTop.reduce((a, x) => a + x.outstanding, 0);
      actions.push({
        label: 'Top-20 exposure — still open',
        note: 'Hand-work these; they are worth more than volume',
        count: openTop.length,
        amount: amt,
      });
    }
  }

  actions.sort((a, b) => b.amount - a.amount);

  return {
    actions,
    openAccounts: t.unresolved,
    openAmount: t.outstandingPending,
  };
}

export function buildSummary({ campaign, days, date = '', display = '' }) {
  const trend = buildTrend(days);
  const first = trend[0];
  const last = trend[trend.length - 1];

  const comparable = first && last && first !== last && last.sameBook;

  return {
    version: SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    date,
    display,
    days: trend.length,
    trend,
    movement: comparable
      ? {
        from: first.label,
        to: last.label,
        recovered: last.recovered - first.recovered,
        resolved: last.resolved - first.resolved,
        resolutionPts: last.resolutionPct - first.resolutionPct,
      }
      : null,
    campaign,
    findings: buildFindings(campaign),
    ...buildActions(campaign),
  };
}
