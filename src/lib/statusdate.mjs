const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export function parseStatusDate(filename) {
  const m = filename.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[^A-Za-z\d]{0,3}(\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2].toLowerCase().slice(0, m[2].length >= 4 && MONTHS[m[2].toLowerCase()] ? 4 : 3)] ?? MONTHS[m[2].toLowerCase()];
  if (!mon || day < 1 || day > 31) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
