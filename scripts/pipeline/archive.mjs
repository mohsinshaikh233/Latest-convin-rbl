import fs from 'node:fs';
import path from 'node:path';
import { check, env } from './config.mjs';

let announced = false;

async function s3Client() {
  const { S3Client, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: env('S3_REGION'),
    credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
  });
  const Bucket = env('S3_BUCKET');
  return {
    async head(Key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key }));
        return { size: r.ContentLength };
      } catch (e) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
        throw e;
      }
    },
    async put(Key, body) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body: body }));
    },
  };
}

function offReason(ctx) {
  if (ctx?.dryRun) return 'dry run — nothing is uploaded';
  if (!env('S3_PREFIX_ARCHIVE')) {
    return 'S3_PREFIX_ARCHIVE is not set — source archiving is OFF. ' +
      'July and August 2026 became unauditable this way; set it as soon as the S3 credentials land.';
  }
  const { ok, missing } = check('s3');
  if (!ok) return `archiving needs the S3 config it shares with stage 01 — missing: ${missing.join(', ')}`;
  return null;
}

export async function archiveSources(ctx, month, entries, opts = {}) {
  const log = ctx?.log ?? (() => {});
  const off = offReason(ctx);
  if (off) {
    if (!announced) { log(`  archive: ${off}`); announced = true; }
    return { enabled: false, reason: off, archived: [], skipped: [], failed: [] };
  }

  const prefix = env('S3_PREFIX_ARCHIVE').replace(/\/+$/, '');
  const archived = []; const skipped = []; const failed = [];

  let client;
  try {
    client = opts.client ?? await s3Client();
  } catch (e) {
    const reason = `could not create an S3 client: ${e.message}`;
    log(`  ⚠ archive: ${reason}`);
    return { enabled: true, reason, archived: [], skipped: [], failed: entries.map((e2) => ({ key: e2.key, reason })) };
  }

  for (const entry of entries) {
    const Key = `${prefix}/${month}/${entry.key}`;
    try {
      if (!fs.existsSync(entry.path)) { failed.push({ key: Key, reason: 'local file no longer exists' }); continue; }
      const size = fs.statSync(entry.path).size;

      const existing = await client.head(Key);
      if (existing && existing.size === size) { skipped.push({ key: Key, bytes: size }); continue; }

      await client.put(Key, fs.readFileSync(entry.path));
      archived.push({ key: Key, bytes: size });
    } catch (e) {
      failed.push({ key: Key, reason: e.message });
    }
  }

  if (archived.length || failed.length || skipped.length) {
    log(`  archive: ${archived.length} uploaded, ${skipped.length} already present${failed.length ? `, ${failed.length} FAILED` : ''}`);
  }
  for (const f of failed) log(`    ⚠ ${f.key} — ${f.reason}`);

  return { enabled: true, archived, skipped, failed };
}

export const archiveSummary = (res) => ({
  enabled: res.enabled,
  ...(res.reason ? { reason: res.reason } : {}),
  uploaded: res.archived.length,
  alreadyPresent: res.skipped.length,
  failed: res.failed.length,
  ...(res.failed.length ? { failures: res.failed.slice(0, 20) } : {}),
  at: new Date().toISOString(),
});

export const _resetAnnounced = () => { announced = false; };

export const cohortArchiveKey = (cohortKey) => `calllogs/${String(cohortKey).replace('|', '__')}.csv`;
export const bookArchiveKey = (filename) => `books/${path.basename(filename)}`;
export const statusArchiveKey = (filename) => `status/${path.basename(filename)}`;
