export function validToken(tok, year = '2026') {
  if (typeof tok !== 'string' || tok.length !== 8 || !/^\d{8}$/.test(tok)) return false;
  if (tok.slice(4) !== year) return false;
  const mm = Number(tok.slice(2, 4));
  const dd = Number(tok.slice(0, 2));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

export function splitExternalId(value, year = '2026') {
  const v = String(value ?? '').trim();
  if (!v) return { account: null, loadDate: null };

  let tok = v.includes('_') ? v.slice(v.lastIndexOf('_') + 1) : v.slice(-8);

  if (tok.length === 9) {
    const c = tok.slice(0, 2) + tok.slice(3);
    tok = validToken(c, year) ? c : tok.slice(-8);
  }
  if (tok.length === 7) tok = tok.slice(0, 4) + year;

  if (!validToken(tok, year)) return { account: null, loadDate: null };

  const account = v.includes('_') ? v.slice(0, v.lastIndexOf('_')) : v.slice(0, -8);
  return { account, loadDate: `${tok.slice(4)}-${tok.slice(2, 4)}-${tok.slice(0, 2)}` };
}

export function loadDateHistogram(values, year = '2026') {
  const counts = new Map();
  let unreadable = 0;
  for (const v of values) {
    const { loadDate } = splitExternalId(v, year);
    if (!loadDate) { unreadable++; continue; }
    counts.set(loadDate, (counts.get(loadDate) ?? 0) + 1);
  }
  return {
    unreadable,
    dates: [...counts.entries()].map(([date, rows]) => ({ date, rows })).sort((a, b) => b.rows - a.rows),
  };
}
