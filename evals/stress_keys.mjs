import { normalizeAccount, accountKey, isCorruptAccount, decodesTo, autoMap, isResolved } from '../src/lib/normalize.mjs';

const TRUE = '0007476780006975616';
let checks = 0, fails = 0;
const t = (label, got, want) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? '✔' : '✘'} ${label.padEnd(48)} ${JSON.stringify(got)}${ok ? '' : `   EXPECTED ${JSON.stringify(want)}`}`);
};

console.log('\n══ UNWRAPPING THE KEY ══\n');
t('plain 19-digit',                    normalizeAccount('0007476780006975616'),               TRUE);
t('Convin composite "<acct>_<date>#"', normalizeAccount('0007476780006975616_03072026#'),     TRUE);
t('underscore, no hash',               normalizeAccount('0007476780006975616_03072026'),      TRUE);
t('pipe-delimited',                    normalizeAccount('0007476780006975616|BATCH9'),        TRUE);
t('colon-delimited',                   normalizeAccount('0007476780006975616:2026'),          TRUE);
t('prefixed by a system code',         normalizeAccount('RBL-0007476780006975616_03072026#'), TRUE);
t('grouped with hyphens for humans',   normalizeAccount('0007476-780006-975616'),             TRUE);
t('padded with spaces',                normalizeAccount(' 0007476 780006 975616 '),           TRUE);
t('trailing hash',                     normalizeAccount('0007476780006975616#'),              TRUE);
t('shorter number FIRST in the key',   normalizeAccount('12345678_0007476780006975616'),      TRUE);
t('leading zeros are PRESERVED',       normalizeAccount('0007476780006975616').startsWith('000'), true);

console.log('\n══ RECOGNISING THE WRECKAGE ══\n');
t('scientific notation is corrupt',    isCorruptAccount('7.47678E+15'),                       true);
t('lowercase e too',                   isCorruptAccount('7.47678e+15'),                       true);
t('a real account is not corrupt',     isCorruptAccount(TRUE),                                false);
t('a composite key is not corrupt',    isCorruptAccount('0007476780006975616_03072026#'),     false);
t('corrupt value is NOT laundered',    normalizeAccount('7.47678E+15'),                       '7.47678E+15');

console.log('\n══ THE ROUND-TRIP GUARD ══\n');
t('the true account is consistent',    decodesTo(TRUE, '7.47678E+15'),                        true);
t('4-decimal mantissa',                decodesTo('0007477800069756160', '7.4778E+15'),        true);
t('an unrelated account is rejected',  decodesTo('0005369077354021471', '7.47678E+15'),       false);
t('a mobile number is rejected',       decodesTo('919836337587', '7.47678E+15'),              false);
t('an outstanding balance is rejected',decodesTo('81143', '7.47678E+15'),                     false);
t('garbage is rejected',               decodesTo('abc', '7.47678E+15'),                       false);
t('empty is rejected',                 decodesTo('', '7.47678E+15'),                          false);

console.log('\n══ CHOOSING THE COLUMN ══\n');
{
  const r = accountKey({ 'Account No': TRUE }, null);
  t('clean key: used as-is', r.key, TRUE);
  t('clean key: not flagged as recovered', r.recovered, false);
}
{
  const r = accountKey({ account_number: '7.47678E+15', 'External ID': `${TRUE}_03072026#` },
    { account_no: 'account_number' });
  t('wrecked key, External ID lifeboat', r.key, TRUE);
  t('  flagged as recovered', r.recovered, true);
  t('  names the rescuing column', r.from, 'External ID');
}
{
  const r = accountKey({ account_number: '7.47678E+15', 'Some Vendor Ref': `XY/${TRUE}/2026` },
    { account_no: 'account_number' });
  t('survivor in an UNKNOWN column', r.key, TRUE);
  t('  names it', r.from, 'Some Vendor Ref');
}
{
  const r = accountKey(
    { account_number: '7.47678E+15', 'Mobile Number': '919836337587', 'Some Ref': '0005369077354021471' },
    { account_no: 'account_number' },
  );
  t('unrelated long numbers are REJECTED', r.corrupt, true);
  t('  does not adopt the mobile number', r.key, '7.47678E+15');
}
{
  const r = accountKey({ account_number: '7.47678E+15' }, { account_no: 'account_number' });
  t('no lifeboat anywhere: reported corrupt', r.corrupt, true);
  t('  and never silently dropped', !!r.key, true);
}
{
  const r = accountKey({ account_number: '9.99999E+15', 'Account No': TRUE }, { account_no: 'account_number' });
  t('known alias, clean but unproven: used', r.key, TRUE);
  t('  flagged unverified, not silently trusted', r.verified, false);
}
{
  const r = accountKey({ account_number: '9.99999E+15', 'Random Ref': TRUE }, { account_no: 'account_number' });
  t('unknown column, unproven: REFUSED', r.corrupt, true);
}

console.log('\n══ DECORATED HEADERS (a "#" must not lose the column) ══\n');

t('header "Account No#" still resolves',   accountKey({ 'Account No#': TRUE }, null).key,         TRUE);
t('header "ACCOUNT_NO" (case/punct)',      accountKey({ 'ACCOUNT_NO': TRUE }, null).key,          TRUE);
t('header "Account No ." trailing dot',    accountKey({ 'Account No .': TRUE }, null).key,        TRUE);
t('autoMap detects "Account No#"',         autoMap(['Account No#', 'Bucket', 'status']).account_no, 'Account No#');
t('autoMap detects lowercase account_no',  autoMap(['account_no', 'status']).account_no,          'account_no');

console.log('\n══ RESOLVED VOCABULARY (RBL bucket files: Normalisation / STAB / RB) ══\n');

t('literal "Resolved"',            isResolved({ status: 'Resolved' }),      true);
t('lowercase "resolved"',          isResolved({ status: 'resolved' }),      true);
t('"Normalisation" counts',        isResolved({ status: 'Normalisation' }), true);
t('"STAB" counts',                 isResolved({ status: 'STAB' }),          true);
t('"RB" counts',                   isResolved({ status: 'RB' }),            true);
t('"Unresolved" does NOT count',   isResolved({ status: 'Unresolved' }),    false);
t('empty status does NOT count',   isResolved({ status: '' }),              false);

console.log(`\n${'─'.repeat(72)}`);
console.log(`${checks} checks · ${fails} failure(s)\n`);
if (fails) process.exitCode = 1;
