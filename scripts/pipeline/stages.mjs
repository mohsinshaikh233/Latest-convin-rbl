export const STAGES = {
  '00': '00_preflight.mjs',
  '01': '01_fetch.mjs',
  '02': '02_plan.mjs',
  '03': '03_export.mjs',
  '04': '04_collect.mjs',
  '05': '05_assemble.mjs',
  '06': '06_build.mjs',
  '07': '07_verify.mjs',
  '08': '08_client.mjs',

  lock: 'lock.mjs',
};

export const ORDER = Object.keys(STAGES).filter((s) => /^\d{2}$/.test(s));

export const WORK_STAGES = ORDER.filter((s) => s !== '00');

export const stageName = (stage) => String(STAGES[stage] ?? '').replace(/^\d+_|\.mjs$/g, '');
