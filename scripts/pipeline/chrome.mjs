import fs from 'node:fs';
import { spawn } from 'node:child_process';

export const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

export const findChrome = () => CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pdfComplete(file, lastSize) {
  if (!fs.existsSync(file)) return { done: false, size: -1 };
  const size = fs.statSync(file).size;
  if (size === 0 || size !== lastSize) return { done: false, size };
  const tail = Buffer.alloc(Math.min(1024, size));
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
  } finally {
    fs.closeSync(fd);
  }
  return { done: tail.includes('%%EOF'), size };
}

export async function renderPdf(chrome, htmlPath, outPath, { timeoutMs = 120000, log = () => {} } = {}) {
  fs.rmSync(outPath, { force: true });
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-pdf-header-footer',
    `--print-to-pdf=${outPath}`,
    `file://${htmlPath}`,
  ], { stdio: 'ignore' });

  const started = Date.now();
  let lastSize = -1;
  try {
    while (Date.now() - started < timeoutMs) {
      await sleep(400);
      const { done, size } = pdfComplete(outPath, lastSize);
      lastSize = size;
      if (done) {
        log(`    rendered ${(size / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return { ok: true, bytes: size };
      }
      if (child.exitCode !== null && child.exitCode !== 0 && size <= 0) {
        return { ok: false, reason: `chrome exited ${child.exitCode} without writing a PDF` };
      }
    }
    return { ok: false, reason: `timed out after ${timeoutMs}ms with ${lastSize < 0 ? 'no file' : `${lastSize} bytes and no %%EOF`}` };
  } finally {
    child.kill('SIGKILL');
  }
}
