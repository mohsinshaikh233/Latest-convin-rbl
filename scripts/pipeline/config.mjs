export const GROUPS = {
  s3: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_BUCKET', 'S3_PREFIX_BOOKS', 'S3_PREFIX_STATUS'],
  convin: ['CONVIN_TENANT', 'CONVIN_CAMPAIGN_PREX', 'CONVIN_CAMPAIGN_BUCKET'],
  convinAuth: ['CONVIN_TOKEN'],
  imap: ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD'],
  db: ['DATABASE_URL'],
};

export function check(...groupNames) {
  const missing = [];
  for (const g of groupNames) {
    for (const key of GROUPS[g] ?? [g]) {
      if (!process.env[key] || process.env[key].trim() === '') missing.push(key);
    }
  }
  return { ok: missing.length === 0, missing };
}

export function need(...groupNames) {
  const { ok, missing } = check(...groupNames);
  if (!ok) {
    throw new ConfigError(
      `missing required config: ${missing.join(', ')}\n` +
      `  Add these to .env.local (see "Config to add to .env.local" in HANDOFF_AUTOMATION.md).`,
      missing,
    );
  }
}

export function needConvinAuth() {
  const hasToken = !!process.env.CONVIN_TOKEN?.trim();
  const hasLogin = !!process.env.CONVIN_EMAIL?.trim() && !!process.env.CONVIN_PASSWORD?.trim();
  if (!hasToken && !hasLogin) {
    throw new ConfigError(
      'missing required config: CONVIN_TOKEN (or CONVIN_EMAIL + CONVIN_PASSWORD for the Playwright path)\n' +
      '  Add these to .env.local (see "Config to add to .env.local" in HANDOFF_AUTOMATION.md).',
      ['CONVIN_TOKEN|CONVIN_EMAIL+CONVIN_PASSWORD'],
    );
  }
}

export class ConfigError extends Error {
  constructor(message, missing) {
    super(message);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

export const env = (key, dflt = undefined) => process.env[key] ?? dflt;
