import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const PORT = Number(flag('port', 4598));
const SEED = flag('seed', '');
const BUCKET = flag('bucket', 'rbl-collections');

const DATES = flag('dates', '');

const PAGE = Number(flag('page-size', 5));

export const MODES = {
  'paginate': 'ListObjectsV2 returns few keys per page so the ContinuationToken loop actually runs. ON by default.',
  'vanishing-key': 'one key is listed but 404s on GET — the classic race between LIST and GET.',
  'truncated-body': 'one object returns fewer bytes than its Content-Length. Must fail loudly, never write a short file.',
  'slow-object': 'one object takes ~30 s (or --slow-ms) so nothing is silently timing out.',
  'denied-prefix': 'AccessDenied on one prefix. The error must name the prefix, not say "fetch failed".',
};

const state = {
  modes: new Set((flag('modes', 'paginate') || '').split(',').map((s) => s.trim()).filter(Boolean)),
  slowMs: Number(flag('slow-ms', 30_000)),
  deniedPrefix: flag('denied-prefix', ''),
  victim: null,
  gets: [],
  lists: [],
};
const has = (m) => state.modes.has(m);
const log = (...a) => console.error('[fake-s3]', ...a);

function scan(dir, prefix, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scan(full, `${prefix}${e.name}/`, out); continue; }
    if (!/\.(xlsx|xls|csv)$/i.test(e.name)) continue;
    const st = fs.statSync(full);
    out.push({
      Key: `${prefix}${e.name}`,
      file: full,
      Size: st.size,

      LastModified: st.mtime,
      ETag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
    });
  }
  return out;
}

const stated = DATES && fs.existsSync(DATES) ? JSON.parse(fs.readFileSync(DATES, 'utf8')) : {};

const objects = [];
if (SEED) {
  const bookDirs = ['Calling File', 'books'];
  const statusDirs = ['Status Files', 'status'];
  for (const d of bookDirs) if (fs.existsSync(path.join(SEED, d))) scan(path.join(SEED, d), 'books/', objects);
  for (const d of statusDirs) if (fs.existsSync(path.join(SEED, d))) scan(path.join(SEED, d), 'status/', objects);
}

let restated = 0;
for (const o of objects) {
  if (stated[o.Key]) { o.LastModified = new Date(stated[o.Key]); restated++; }
}
if (DATES) log(`${restated} of ${objects.length} object(s) served with a STATED LastModified from ${DATES}`);

state.victim = objects.filter((o) => o.Key.startsWith('books/'))[1]?.Key ?? objects[0]?.Key ?? null;

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function listXml({ prefix, contents, truncated, nextToken }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${xmlEscape(BUCKET)}</Name>
  <Prefix>${xmlEscape(prefix)}</Prefix>
  <KeyCount>${contents.length}</KeyCount>
  <MaxKeys>${PAGE}</MaxKeys>
  <IsTruncated>${truncated ? 'true' : 'false'}</IsTruncated>
${truncated ? `  <NextContinuationToken>${xmlEscape(nextToken)}</NextContinuationToken>\n` : ''}${contents.map((o) => `  <Contents>
    <Key>${xmlEscape(o.Key)}</Key>
    <LastModified>${o.LastModified.toISOString()}</LastModified>
    <ETag>${xmlEscape(o.ETag)}</ETag>
    <Size>${o.Size}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>`).join('\n')}
</ListBucketResult>`;
}

const errorXml = (code, message, key) => `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message>${key ? `<Key>${xmlEscape(key)}</Key>` : ''}<RequestId>fake</RequestId></Error>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  const p = url.pathname.replace(/^\//, '').split('/').map((seg) => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  }).join('/');

  if (p === '__state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ objects: objects.length, victim: state.victim, gets: state.gets, lists: state.lists, modes: [...state.modes] })); }
  if (p === '__mode') {
    let b = ''; req.on('data', (d) => { b += d; });
    return req.on('end', () => {
      try {
        const j = JSON.parse(b || '{}');
        if (j.modes) state.modes = new Set(j.modes);
        if (j.slowMs !== undefined) state.slowMs = j.slowMs;
        if (j.deniedPrefix !== undefined) state.deniedPrefix = j.deniedPrefix;
        log('modes →', [...state.modes].join(',') || '(none)');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modes: [...state.modes], victim: state.victim }));
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
  }
  if (p === '__reset') { state.gets = []; state.lists = []; res.writeHead(200); return res.end('{}'); }

  const [bucket, ...rest] = p.split('/');
  if (bucket !== BUCKET) { res.writeHead(404, { 'Content-Type': 'application/xml' }); return res.end(errorXml('NoSuchBucket', `no bucket ${bucket}`)); }
  const key = rest.join('/');

  if (!key && url.searchParams.get('list-type') === '2') {
    const prefix = url.searchParams.get('prefix') ?? '';
    if (state.deniedPrefix && prefix.startsWith(state.deniedPrefix) && has('denied-prefix')) {
      log(`LIST ${prefix} → AccessDenied`);
      res.writeHead(403, { 'Content-Type': 'application/xml' });
      return res.end(errorXml('AccessDenied', `Access Denied for prefix ${prefix}`));
    }
    const all = objects.filter((o) => o.Key.startsWith(prefix));
    const token = url.searchParams.get('continuation-token');
    const from = token ? Number(Buffer.from(token, 'base64').toString('utf8')) : 0;
    const size = has('paginate') ? PAGE : all.length;
    const page = all.slice(from, from + size);
    const nextFrom = from + page.length;
    const truncated = nextFrom < all.length;
    state.lists.push({ prefix, from, returned: page.length, truncated });
    log(`LIST ${prefix} [${from}..${nextFrom}) of ${all.length}${truncated ? ' → more' : ''}`);
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end(listXml({ prefix, contents: page, truncated, nextToken: Buffer.from(String(nextFrom)).toString('base64') }));
  }

  const obj = objects.find((o) => o.Key === key);
  state.gets.push(key);

  if (!obj) { res.writeHead(404, { 'Content-Type': 'application/xml' }); return res.end(errorXml('NoSuchKey', 'The specified key does not exist.', key)); }

  if (has('vanishing-key') && key === state.victim) {
    log(`GET ${key} → NoSuchKey (vanished between LIST and GET)`);
    res.writeHead(404, { 'Content-Type': 'application/xml' });
    return res.end(errorXml('NoSuchKey', 'The specified key does not exist.', key));
  }

  if (has('slow-object') && key === state.victim) {
    log(`GET ${key} → holding for ${state.slowMs}ms`);
    await sleep(state.slowMs);
  }

  const body = fs.readFileSync(obj.file);

  if (has('truncated-body') && key === state.victim) {
    log(`GET ${key} → truncating at half of ${body.length}`);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length), ETag: obj.ETag });
    res.write(body.subarray(0, Math.floor(body.length / 2)));
    return res.destroy();
  }

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length),
    ETag: obj.ETag,
    'Last-Modified': obj.LastModified.toUTCString(),
  });
  return res.end(body);
});

if (process.argv[1] && process.argv[1].endsWith('s3.mjs')) {
  server.listen(PORT, '127.0.0.1', () => {
    log(`listening on http://127.0.0.1:${PORT}  bucket=${BUCKET}`);
    log(`${objects.length} object(s) from ${SEED || '(no seed given)'}`);
    log(`  books/  ${objects.filter((o) => o.Key.startsWith('books/')).length}`);
    log(`  status/ ${objects.filter((o) => o.Key.startsWith('status/')).length}`);
    log(`page size ${PAGE} · modes: ${[...state.modes].join(', ') || '(none)'} · victim: ${state.victim}`);
  });
}

export { server, state, objects };
