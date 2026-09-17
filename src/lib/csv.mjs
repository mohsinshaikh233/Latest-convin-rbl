export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r\n|\n|\r/);
  const rows = [];
  for (const ln of lines) {
    if (ln === '') continue;
    rows.push(parseCsvLine(ln));
  }
  return rows;
}
