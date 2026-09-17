import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const TUNNEL_FILE = () => path.join(process.cwd(), '.tunnel-url');
const strip = (u) => String(u || '').trim().replace(/\/+$/, '');

export function publicBaseUrl(request) {
  const explicit = strip(process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL);
  if (explicit) return { url: explicit, source: 'env' };

  try {
    if (existsSync(TUNNEL_FILE())) {
      const u = strip(readFileSync(TUNNEL_FILE(), 'utf8'));
      if (/^https?:\/\//.test(u)) return { url: u, source: 'tunnel' };
    }
  } catch {  }

  let origin = '';
  try { origin = strip(new URL(request.url).origin); } catch {  }
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(origin);
  return { url: origin, source: isLocal ? 'local' : 'origin' };
}
