import { readFileSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { hasDb } = await import('./src/lib/db.mjs');

if (hasDb()) {
  const host = (process.env.DATABASE_URL.match(/@([^/:]+)/) || [])[1] || 'postgres';
  console.log(`DATABASE_URL is set → rebuilding POSTGRES (${host}).\n`);
  await import('./scripts/rebuild_db.mjs');
} else {
  console.log('No DATABASE_URL → rebuilding the local JSON files.');
  console.log('(If you meant to rebuild the deployed database, put the DIRECT connection');
  console.log(' string in .env.local first — otherwise production keeps the old payload.)\n');
  await import('./rebuild_local.mjs');
}
