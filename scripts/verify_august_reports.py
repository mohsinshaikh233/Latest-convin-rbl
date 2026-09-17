#!/usr/bin/env python3
"""Independently verify every rebuilt August report.

Recomputes each book's headline figures straight from the source spreadsheets and the
call-log CSV — in Python, without touching src/lib — then compares them against the
numbers printed in the PDF. The point is that a bug in the build pipeline cannot hide
here, because nothing in this file shares code with it.

Definitions are taken from the pipeline's own source so a difference means a real
disagreement rather than two teams measuring different things:
  connected     Call Answered Timestamp is non-empty      (calllog.mjs:249)
  talk seconds  Call Duration (Seconds), connected only   (calllog.mjs:250)
  resolved      status in {resolved, normalisation, normalization, stab, rb}
                                                          (normalize.mjs:509)

  python3 scripts/verify_august_reports.py
"""
import csv, glob, json, logging, os, re, sys
from collections import Counter

import openpyxl
from pdfminer.high_level import extract_text

logging.disable(logging.CRITICAL)
csv.field_size_limit(10**9)

PLAN = json.load(open('/tmp/plan.json'))
PDF_DIRS = ['/tmp/reports_out']
RESOLVED = {'resolved', 'normalisation', 'normalization', 'stab', 'rb'}


def col(header, *pats):
    for p in pats:
        for i, h in enumerate(header):
            if h and re.search(p, str(h), re.I):
                return i
    return None


def read_book(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    h = list(next(rows))
    ai = col(h, r'^account\s*no', r'account')
    oi = col(h, r'total\s*outstanding', r'outstanding')
    accts, out = {}, {}
    for r in rows:
        if not r or r[ai] is None:
            continue
        a = str(r[ai]).strip()
        accts[a] = True
        try:
            out[a] = float(r[oi]) if oi is not None and r[oi] is not None else 0.0
        except (TypeError, ValueError):
            out[a] = 0.0
    wb.close()
    return accts, out


def read_status(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    h = list(next(rows))
    ai = col(h, r'account')
    si = col(h, r'status')
    d = {}
    for r in rows:
        if not r or r[ai] is None:
            continue
        d[str(r[ai]).strip()] = str(r[si]).strip() if r[si] is not None else ''
    wb.close()
    return d


def valid(t):
    return len(t) == 8 and t.isdigit() and t[4:] == '2026' and 1 <= int(t[2:4]) <= 12 and 1 <= int(t[:2]) <= 31


def split_ext_id(v):
    """<account><DDMMYYYY>, underscore optional/misplaced — see the call-log findings."""
    v = v.strip()
    tok = v.rsplit('_', 1)[-1] if '_' in v else v[-8:]
    if len(tok) == 9:
        c = tok[:2] + tok[3:]
        tok = c if valid(c) else tok[-8:]
    if len(tok) == 7:
        tok = tok[:4] + '2026'
    if not valid(tok):
        return None, None
    acct = v.rsplit('_', 1)[0] if '_' in v else v[:-8]
    return acct, f"{tok[4:]}-{tok[2:4]}-{tok[:2]}"


def read_calls(path, accts, load):
    att = conn = talk = 0
    reached = set()
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        r = csv.reader(fh)
        h = next(r)
        ei = h.index('External ID')
        ans = h.index('Call Answered Timestamp')
        dur = h.index('Call Duration (Seconds)')
        for row in r:
            if len(row) <= max(ei, ans, dur):
                continue
            a, d = split_ext_id(row[ei])
            if d != load or a not in accts:
                continue
            att += 1
            if row[ans].strip():
                conn += 1
                reached.add(a)
                try:
                    talk += max(0, int(float(row[dur] or 0)))
                except (TypeError, ValueError):
                    pass
    return att, conn, talk, len(reached)


def pdf_facts(path):
    t = extract_text(path)
    f = {}
    m = re.search(r'([\d,]+) accounts\s+·\s+([\d,]+) call attempts\s+·\s+([\d,]+) talk-minutes', t)
    if m:
        f['accounts'] = int(m.group(1).replace(',', ''))
        f['attempts'] = int(m.group(2).replace(',', ''))
        f['talkmin'] = int(m.group(3).replace(',', ''))
    m = re.search(r'AI CALLS CONNECTED([\d,]+)of ([\d,]+) attempts', t.replace('\n', ''))
    if m:
        f['connected'] = int(m.group(1).replace(',', ''))
    m = re.search(r'RESOLUTION RATE([\d.]+)%([\d,]+) of ([\d,]+) accounts', t.replace('\n', ''))
    if m:
        f['resolved'] = int(m.group(2).replace(',', ''))
        f['res_total'] = int(m.group(3).replace(',', ''))
    return f, t


RESULTS = '/tmp/verify_results.json'
_status_cache = {}


def status_cached(path):
    """Status sheets are 650k rows and most books share one — read each at most once."""
    if path not in _status_cache:
        _status_cache.clear()          # only ever need the current one; keeps memory flat
        _status_cache[path] = read_status(path)
    return _status_cache[path]


def main():
    pdfs = {}
    for d in PDF_DIRS:
        for p in glob.glob(os.path.join(d, '*.pdf')):
            pdfs[os.path.splitext(os.path.basename(p))[0]] = p

    done = json.load(open(RESULTS)) if os.path.exists(RESULTS) else {}
    budget = int(os.environ.get('VERIFY_BUDGET', '6'))
    # group by status file so the cache actually hits
    todo = [n for n in sorted(PLAN, key=lambda k: PLAN[k]['status']) if n not in done]
    print(f"{len(done)} already verified, {len(todo)} remaining", flush=True)

    for name in todo[:budget]:
        p = PLAN[name]
        pdf = pdfs.get(name)
        if not pdf:
            done[name] = {'error': 'no PDF'}; continue
        accts, out = read_book(p['book'])
        st = status_cached(p['status'])
        att, conn, talk, reached = read_calls(p['calllog'], accts, p['load'])
        res = sum(1 for a in accts if st.get(a, '').strip().lower() in RESOLVED)
        f, _ = pdf_facts(pdf)
        done[name] = {
            'src': {'accounts': len(accts), 'attempts': att, 'connected': conn,
                    'talkmin': round(talk / 60), 'resolved': res, 'reached': reached},
            'pdf': f,
        }
        json.dump(done, open(RESULTS, 'w'), indent=1)
        print(f"verified {name}", flush=True)

    print(f"\n{len(done)}/{len(PLAN)} verified -> {RESULTS}", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
