import fs from 'node:fs';
import path from 'node:path';
import { need, env } from './config.mjs';
import { pipelineRoot, rawDir } from './paths.mjs';
import { archiveSources, archiveSummary, bookArchiveKey, statusArchiveKey } from './archive.mjs';
import { parseStatusDate } from './dates.mjs';

async function s3Client() {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');

  const endpoint = env('S3_ENDPOINT');
  const client = new S3Client({
    region: env('S3_REGION'),
    credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  return { client, ListObjectsV2Command, GetObjectCommand };
}

async function listAll(client, ListObjectsV2Command, bucket, prefix) {
  const out = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents ?? []) out.push(o);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function download(client, GetObjectCommand, bucket, key, destPath) {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

function loadDateOf(obj) {
  return obj.LastModified.toISOString().slice(0, 10);
}

const SHEET = /\.(xlsx|xls)$/i;
const CALLLOG = /\.csv$/i;

function looksLikeStatus(name) {
  return /status/i.test(name) && !!parseStatusDate(name);
}

const skippedCsv = [];

function walkSheets(dir, depth = 0) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 2) out.push(...walkSheets(full, depth + 1));
    } else if (e.isFile() && SHEET.test(e.name)) {
      out.push(full);
    } else if (e.isFile() && CALLLOG.test(e.name)) {
      skippedCsv.push(full);
    }
  }
  return out;
}

async function runFromDir(ctx, fromDir) {
  const { month } = ctx;
  const src = path.resolve(fromDir);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return { code: 1, result: { ok: false, month, reason: `--from-dir ${src} is not a directory` } };
  }

  let stated = {};
  let statedFrom = [];
  for (const d of [src, ...fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(src, e.name))]) {
    const statedPath = path.join(d, 'loaddates.json');
    if (!fs.existsSync(statedPath)) continue;
    try {
      stated = { ...JSON.parse(fs.readFileSync(statedPath, 'utf8')), ...stated };
      statedFrom.push(statedPath);
    } catch (e) {
      ctx.log(`  \u26a0 ${statedPath} does not parse (${e.message}) — ignoring it and falling back to file mtimes`);
    }
  }

  const root = rawDir(month);
  skippedCsv.length = 0;
  const files = walkSheets(src);
  const books = {}; const allStatusFiles = []; const copied = [];

  for (const full of files) {
    const name = path.basename(full);
    const isStatus = looksLikeStatus(name);
    const dest = path.join(root, isStatus ? 'status' : 'books', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(full).size) {
      fs.copyFileSync(full, dest);
      copied.push(name);
    }
    const loadDate = stated[name] ? String(stated[name]).slice(0, 10) : new Date(fs.statSync(full).mtime).toISOString().slice(0, 10);
    const loadDateSource = stated[name] ? 'operator-stated' : 'file-mtime';
    if (isStatus) allStatusFiles.push({ file: name, path: dest, loadDate, loadDateSource, asOf: parseStatusDate(name) });
    else books[path.basename(name, path.extname(name))] = { file: name, path: dest, loadDate, loadDateSource };
  }

  if (!Object.keys(books).length) {
    return {
      code: 1,
      result: { ok: false, month, source: src, reason: `no book sheets (.xlsx/.xls/.csv) found under ${src} — ${allStatusFiles.length} status file(s) were found, so the folder is probably right but the books are somewhere else` },
    };
  }

  ctx.log(`  from-dir ${src} — ${copied.length} copied, ${files.length - copied.length} already present · ${Object.keys(books).length} books · ${allStatusFiles.length} status files${skippedCsv.length ? ` · ${skippedCsv.length} CSV(s) left for stage 03` : ''}`);
  const mtimed = Object.values(books).filter((b) => b.loadDateSource === 'file-mtime');
  ctx.log(`  load dates: ${Object.keys(stated).length ? `${Object.keys(stated).length} stated in ${statedFrom.map((f) => path.relative(src, f)).join(', ')}, ` : ''}${mtimed.length} from file mtime — NEVER derived from a filename`);
  if (mtimed.length) ctx.log(`  \u26a0 ${mtimed.length} book(s) have a load date taken from the file's mtime, which is when it landed on THIS disk: ${mtimed.map((b) => `${b.file} \u2192 ${b.loadDate}`).join(', ')}. State the real dates in loaddates.json if that is not right.`);

  return {
    code: 0,
    result: {
      ok: true, month, source: src, fromDir: true,
      fetched: copied.length,
      skipped: files.length - copied.length,
      books: Object.keys(books).length,
      statusFiles: allStatusFiles.length,
      callLogsSeen: skippedCsv.length,
      loadDateSources: { operatorStated: Object.values(books).filter((b) => b.loadDateSource === 'operator-stated').length, fileMtime: Object.values(books).filter((b) => b.loadDateSource === 'file-mtime').length },
      state: { raw: { objects: {} }, books, statusFiles: allStatusFiles, root, source: src, fromDir: true },
    },
  };
}

export async function run(ctx) {
  const fromDirIdx = process.argv.indexOf('--from-dir');
  if (fromDirIdx >= 0 && process.argv[fromDirIdx + 1]) return runFromDir(ctx, process.argv[fromDirIdx + 1]);

  need('s3');
  const { month } = ctx;
  const bucket = env('S3_BUCKET');
  const prefixBooks = env('S3_PREFIX_BOOKS');
  const prefixStatus = env('S3_PREFIX_STATUS');

  const { client, ListObjectsV2Command, GetObjectCommand } = await s3Client();
  const root = rawDir(month);
  const state = ctx.state;

  state.raw = state.stages?.['01']?.raw ?? state.raw ?? { objects: {} };
  state.raw.objects ??= {};

  ctx.log(`listing s3://${bucket}/${prefixBooks} and /${prefixStatus} …`);
  const [bookObjs, statusObjs] = await Promise.all([
    listAll(client, ListObjectsV2Command, bucket, prefixBooks),
    listAll(client, ListObjectsV2Command, bucket, prefixStatus),
  ]);

  const dry = !!ctx.dryRun;
  const wouldFetch = [];
  const fetched = []; const skipped = [];
  const books = {};
  const statusFiles = {};

  const allStatusFiles = [];

  for (const obj of bookObjs) {
    const name = path.basename(obj.Key);
    if (!name || obj.Key.endsWith('/')) continue;
    const loadDate = loadDateOf(obj);
    const dest = path.join(root, 'books', name);
    const known = state.raw.objects[obj.Key];
    if (known && known.etag === obj.ETag && fs.existsSync(dest)) {
      skipped.push(name);
    } else if (dry) {
      wouldFetch.push({ name, key: obj.Key, loadDate, sizeMB: +(obj.Size / 1048576).toFixed(1) });
    } else {
      await download(client, GetObjectCommand, bucket, obj.Key, dest);
      state.raw.objects[obj.Key] = { etag: obj.ETag, size: obj.Size, loadDate, path: dest };
      fetched.push(name);
    }
    books[path.basename(name, path.extname(name))] = { file: name, path: dest, loadDate };
  }

  for (const obj of statusObjs) {
    const name = path.basename(obj.Key);
    if (!name || obj.Key.endsWith('/')) continue;
    const loadDate = loadDateOf(obj);
    const dest = path.join(root, 'status', name);
    const known = state.raw.objects[obj.Key];
    if (known && known.etag === obj.ETag && fs.existsSync(dest)) {
      skipped.push(name);
    } else if (dry) {
      wouldFetch.push({ name, key: obj.Key, loadDate, sizeMB: +(obj.Size / 1048576).toFixed(1) });
    } else {
      await download(client, GetObjectCommand, bucket, obj.Key, dest);
      state.raw.objects[obj.Key] = { etag: obj.ETag, size: obj.Size, loadDate, path: dest };
      fetched.push(name);
    }
    allStatusFiles.push({ file: name, path: dest, loadDate });
  }

  if (dry) {
    ctx.log(`  DRY RUN — ${wouldFetch.length} object(s) would be fetched, ${skipped.length} already present · ${Object.keys(books).length} books · ${allStatusFiles.length} status files`);
    return {
      code: 0,
      result: {
        ok: true, month, dryRun: true,
        wouldFetch: wouldFetch.length,
        wouldFetchMB: +wouldFetch.reduce((a, o) => a + o.sizeMB, 0).toFixed(1),
        skipped: skipped.length,
        books: Object.keys(books).length,
        statusFiles: allStatusFiles.length,
        objects: wouldFetch,
        state: { dryRun: true },
      },
    };
  }

  const archive = await archiveSources(ctx, month, [
    ...Object.values(books).map((b) => ({ path: b.path, key: bookArchiveKey(b.file) })),
    ...allStatusFiles.map((s) => ({ path: s.path, key: statusArchiveKey(s.file) })),
  ]);

  const result = {
    ok: true,
    month,
    fetched: fetched.length,
    skipped: skipped.length,
    books: Object.keys(books).length,
    statusFiles: allStatusFiles.length,
    archive: archiveSummary(archive),
    state: { raw: state.raw, books, statusFiles: allStatusFiles, root, archive: archiveSummary(archive) },
  };
  if (archive.failed.length) {
    result.warnings = [`${archive.failed.length} source file(s) failed to archive — the month is fine, but those inputs are not durably stored`];
  }
  ctx.log(`  ${fetched.length} fetched, ${skipped.length} already present · ${Object.keys(books).length} books · ${allStatusFiles.length} status files`);
  return { code: 0, result };
}
