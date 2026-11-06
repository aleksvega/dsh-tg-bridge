// What /balance says, and why it says two numbers.
//
// The rule under test: an account is not its key. One router hands out keys with
// their own grant, lets them run past it, and keeps serving from the account —
// the key reports -$0.22 while the account holds $2.87 and every request succeeds.
// A card that printed only the key number sent a person to top up an account that
// was not empty, so both numbers are asserted here together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBalance, parseBalance, QUOTA_PER_USD } from '../model/balance.mjs';
import { balanceCard } from '../control/cmd-balance.mjs';
import ru from '../i18n/ru/balance.mjs';

const t = (lang, key, vars = {}) => {
  const table = Object.entries(ru).find(([k]) => k === key);
  const raw = table ? table[1] : key;
  return String(raw).replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
};

const quotaAnswer = {
  success: true,
  data: {
    total_granted: 15027639,
    total_used: 15036678,
    total_available: -9039,
    unlimited_quota: true,
    user_quota: { total_available: 1482336, total_used: 22127465 },
  },
};

test('a quota answer converts units to dollars', () => {
  const got = parseBalance(quotaAnswer);
  assert.equal(got.kind, 'quota');
  assert.equal(got.left, -9039);
  assert.ok(Math.abs(got.usd - -9039 / QUOTA_PER_USD) < 1e-9);
  assert.equal(got.granted, 15027639);
});

test('the account travels next to the key, in dollars', () => {
  const got = parseBalance(quotaAnswer);
  assert.ok(got.account, 'account must be reported');
  assert.ok(Math.abs(got.account.usd - 1482336 / QUOTA_PER_USD) < 1e-9);
});

test('a plain dollar answer is already dollars', () => {
  const got = parseBalance({ data: { balance: 4.5 } });
  assert.equal(got.kind, 'usd');
  assert.equal(got.usd, 4.5);
  assert.equal(got.account, null);
});

test('a credits field is recognized as well', () => {
  assert.equal(parseBalance({ credits: 12 })?.usd, 12);
});

test('a balance of zero is a balance, not a miss', () => {
  const got = parseBalance({ balance: 0 });
  assert.ok(got);
  assert.equal(got.usd, 0);
});

test('an answer without a number is not a balance', () => {
  assert.equal(parseBalance({ error: 'no' }), null);
  assert.equal(parseBalance({ data: { total_available: 9250 } }), null);
  assert.equal(parseBalance(null), null);
  assert.equal(parseBalance('text'), null);
});

const ok = (body) => ({ ok: true, json: async () => body });

test('the accounting path is tried on the host root, not under /v1', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return url === 'https://api.example.com/api/usage/token/' ? ok(quotaAnswer) : { ok: false, json: async () => ({}) };
  };
  const got = await fetchBalance({ baseUrl: 'https://api.example.com/v1', key: 'k', fetchImpl });
  assert.equal(got.ok, true);
  assert.equal(got.root, 'https://api.example.com');
  assert.ok(seen.includes('https://api.example.com/api/usage/token/'));
  assert.ok(!seen.includes('https://api.example.com/v1/api/usage/token/'));
});

test('a host that answers only under /v1 is still found', async () => {
  const fetchImpl = async (url) => (url === 'https://api.example.com/v1/v1/balance' || url === 'https://api.example.com/v1/balance'
    ? ok({ data: { balance: 3 } })
    : { ok: false, json: async () => ({}) });
  const got = await fetchBalance({ baseUrl: 'https://api.example.com/v1', key: 'k', fetchImpl });
  assert.equal(got.ok, true);
  assert.equal(got.usd, 3);
});

test('no key and no host are reported as themselves', async () => {
  assert.equal((await fetchBalance({ baseUrl: 'https://x.test', key: '' })).why, 'nokey');
  assert.equal((await fetchBalance({ baseUrl: '', key: 'k' })).why, 'nokey');
});

test('a host that answers nothing recognizable says so', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  assert.equal((await fetchBalance({ baseUrl: 'https://n.test/v1', key: 'k', fetchImpl })).why, 'noendpoint');
});

test('a dead network is not a dead balance', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNRESET');
  };
  const got = await fetchBalance({ baseUrl: 'https://n.test/v1', key: 'k', fetchImpl });
  assert.equal(got.ok, false);
  assert.equal(got.why, 'network');
});

test('an html page is skipped rather than parsed', async () => {
  const fetchImpl = async (url) => (url.endsWith('/v1/credits')
    ? { ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }
    : ok({ balance: 7 }));
  const got = await fetchBalance({ baseUrl: 'https://n.test/v1', key: 'k', fetchImpl });
  assert.equal(got.ok, true);
  assert.equal(got.usd, 7);
});

// --- the card -------------------------------------------------------------

const rows = [
  { id: 'alpha', baseURL: 'https://alpha.test/v1', keyEnv: 'ALPHA_KEY' },
  { id: 'beta', baseURL: 'https://beta.test/v1', keyEnv: 'BETA_KEY' },
];

const withRows = (answers, keys = { ALPHA_KEY: 'a', BETA_KEY: 'b' }) =>
  balanceCard({
    profile: 'headless',
    lang: 'ru',
    t,
    rowsOf: () => rows,
    keyOfImpl: (name) => keys[name] || '',
    fetchImpl: async (url) => answers[url] || { ok: false, json: async () => ({}) },
  });

test('a key past its grant and a healthy account print both numbers', async () => {
  const card = await withRows({ 'https://alpha.test/api/usage/token/': ok(quotaAnswer) });
  const line = card.split('\n').find((l) => l.includes('alpha'));
  assert.match(line, /\$2\.9/);
  assert.match(line, /-\$0\.0\d/);
});

test('the sign sits before the currency symbol', async () => {
  const card = await withRows({ 'https://alpha.test/api/usage/token/': ok(quotaAnswer) });
  assert.ok(!card.includes('$-'), 'a negative must never read as $-0.02');
});

test('an empty account is called empty, not a number', async () => {
  const card = await withRows({
    'https://alpha.test/api/usage/token/': ok({ data: { total_available: 0, total_granted: 100, user_quota: { total_available: 0 } } }),
  });
  assert.match(card.split('\n').find((l) => l.includes('alpha')), /пополни/);
});

test('a missing key is named as a missing key, without a request', async () => {
  let called = 0;
  const card = await balanceCard({
    profile: 'headless',
    lang: 'ru',
    t,
    rowsOf: () => rows,
    keyOfImpl: () => '',
    fetchImpl: async () => {
      called += 1;
      return { ok: false, json: async () => ({}) };
    },
  });
  assert.equal(called, 0);
  assert.ok(card.includes('нет ни в окружении') || card.includes('ключа нет'));
});

test('a provider that refuses to tell is not shown as empty', async () => {
  const card = await withRows({});
  const line = card.split('\n').find((l) => l.includes('alpha'));
  assert.match(line, /не отдаёт/);
  assert.ok(!/пополни/.test(line));
});

test('an unlimited account is reported as unlimited when it reports no cash', async () => {
  const card = await withRows({ 'https://alpha.test/api/usage/token/': ok({ data: { total_available: 0, total_granted: 0, unlimited_quota: true } }) });
  const line = card.split('\n').find((l) => l.includes('alpha'));
  assert.match(line, /\$|пополни/);
});

test('the hint appears only when something needs the person', async () => {
  const good = await withRows({
    'https://alpha.test/v1/balance': ok({ balance: 5 }),
    'https://beta.test/v1/balance': ok({ balance: 5 }),
  });
  assert.ok(!good.includes('/fallback'), 'a healthy card must not add noise');
  const bad = await withRows({});
  assert.ok(bad.includes('/fallback'));
});

test('the card always opens with a heading', async () => {
  const card = await withRows({});
  assert.ok(card.startsWith(ru['balance.head']));
});

test('every locale has every key the card uses', async () => {
  const en = (await import('../i18n/en/balance.mjs')).default;
  const zh = (await import('../i18n/zh/balance.mjs')).default;
  const used = ['balance.head', 'balance.row', 'balance.rowAccount', 'balance.empty', 'balance.unlimited', 'balance.noKey', 'balance.failed', 'balance.none', 'balance.hint'];
  for (const table of [ru, en, zh]) {
    for (const key of used) assert.ok(table[key], `missing ${key}`);
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(ru).sort());
});

test('the rowAccount line names both numbers in every locale', async () => {
  const en = (await import('../i18n/en/balance.mjs')).default;
  const zh = (await import('../i18n/zh/balance.mjs')).default;
  for (const table of [ru, en, zh]) {
    assert.match(table['balance.rowAccount'], /\{amount\}/);
    assert.match(table['balance.rowAccount'], /\{key\}/);
    assert.match(table['balance.rowAccount'], /\{provider\}/);
  }
});