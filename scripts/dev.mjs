import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const URL_FILE = path.join(process.cwd(), '.tunnel-url');
const PORT = process.env.PORT || '3000';

if (existsSync(URL_FILE)) unlinkSync(URL_FILE);

const bar = (c = '─') => console.log(c.repeat(76));
const children = [];

const next = spawn('npx', ['next', 'dev', '--port', PORT], { stdio: 'inherit', shell: false });
children.push(next);
next.on('exit', (code) => { shutdown(); process.exit(code ?? 0); });

let announced = false;

const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(cf);

cf.on('error', (e) => {
  if (e.code !== 'ENOENT') return;
  setTimeout(() => {
    console.log('');
    bar('═');
    console.log('  NO PUBLIC LINK — cloudflared is not installed');
    bar();
    console.log('  The app is running, and Share links will work on THIS machine only.');
    console.log('  To share with someone else, install it once (free, no account):');
    console.log('');
    console.log('      brew install cloudflared');
    console.log('');
    console.log('  Then restart: npm run dev');
    bar('═');
    console.log('');
  }, 2500);
});

const watch = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || announced) return;
  announced = true;
  const url = m[0];
  writeFileSync(URL_FILE, url);

  setTimeout(() => {
    console.log('');
    bar('═');
    console.log('  PUBLIC LINK IS LIVE');
    bar();
    console.log(`  ${url}`);
    console.log('');
    console.log('  Work at http://localhost:' + PORT + ' as usual — the Share button now hands');
    console.log('  you links on the public address automatically. Copy, send, done.');
    console.log('');
    console.log('  Everything dies when you Ctrl-C. That is the point.');
    bar('═');
    console.log('');
  }, 1200);
};
cf.stdout.on('data', watch);
cf.stderr.on('data', watch);

function shutdown() {
  try { if (existsSync(URL_FILE)) unlinkSync(URL_FILE); } catch {}
  for (const c of children) { try { c.kill(); } catch {} }
}
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('exit', shutdown);
