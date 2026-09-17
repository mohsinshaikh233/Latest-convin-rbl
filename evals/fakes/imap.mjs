import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import hoodiecrow from 'hoodiecrow-imap';

export const USER = 'ops@example.com';
export const PASS = 'not-a-real-password';

export function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-imap-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
    '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  return { dir, key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(cert, 'utf8') };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const human = (iso) => { const [y, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]} ${y}`; };
const slash = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export const SUBJECT_SHAPES = [
  { id: 'iso-range', subject: (c) => `Your AI Call Log export ${c.startDate} to ${c.endDate} is ready`, note: 'ISO dates, the shape matchesCohort() was originally written for' },
  { id: 'human-dates', subject: (c) => `AI Call Log report (${human(c.startDate)} - ${human(c.endDate)}) is ready to download`, note: 'human dates — the most likely real shape' },
  { id: 'slash-dates', subject: (c) => `Call log export ${slash(c.startDate)}-${slash(c.endDate)}`, note: 'slash dates' },
  { id: 'campaign-only', subject: (c) => `Your ${c.campaign} report is ready`, note: 'campaign named, no dates at all — must still be refused' },
  { id: 'generic', subject: () => 'Your report download is ready', note: 'nothing to match on — must still be refused' },
];

const boundary = 'convin-boundary-1';

export function message({ subject, csv, from = 'Convin Reports <no-reply@convin.ai>', date = new Date('2026-08-18T10:00:00Z'), attach = true, filename = 'ai_call_log.csv' }) {
  const head = [
    `From: ${from}`,
    `To: ${USER}`,
    `Subject: ${subject}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  if (!attach) {
    return [...head, 'Content-Type: text/plain; charset=utf-8', '', 'Your export is ready. Download it from the dashboard.', ''].join('\r\n');
  }
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Your export is attached.',
    `--${boundary}`,
    `Content-Type: text/csv; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    csv.replace(/\n/g, '\r\n'),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function start({ port = 4993, messages = [] } = {}) {
  const tls = selfSigned();
  const server = hoodiecrow({
    plugins: ['ID', 'SASL-IR', 'AUTH-PLAIN', 'NAMESPACE', 'ENABLE', 'LITERALPLUS', 'UNSELECT', 'SPECIAL-USE'],
    secureConnection: true,
    credentials: { key: tls.key, cert: tls.cert },
    id: { name: 'fake-imap', version: '1' },
    users: { [USER]: { password: PASS, xoauth2: {} } },
    storage: { INBOX: { messages: messages.map((raw) => ({ raw })) } },
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({
      server,
      port,
      close: () => new Promise((r) => { try { server.close(r); } catch { r(); } fs.rmSync(tls.dir, { recursive: true, force: true }); }),
    }));
  });
}
