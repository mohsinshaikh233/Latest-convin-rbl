export function unionByAccount(chunks) {
  const byAccount = new Map();
  let duplicates = 0;
  let noAccount = 0;

  for (const rows of chunks) {
    for (const r of rows) {
      const key = String(r.account_no ?? '').trim();
      if (!key) {
        noAccount++;
        continue;
      }
      if (byAccount.has(key)) duplicates++;
      byAccount.set(key, r);
    }
  }

  return {
    rows: [...byAccount.values()],
    duplicates,
    noAccount,
    sources: chunks.length,
  };
}

const slotOf = (v) => { const m = String(v ?? '').match(/__u(\d+)(?!\d)/); return m ? Number(m[1]) : NaN; };
export function bySlot(a, b) {
  const x = slotOf(a); const y = slotOf(b);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return String(a ?? '').localeCompare(String(b ?? ''));
}
