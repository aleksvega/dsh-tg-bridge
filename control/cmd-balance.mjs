// `/balance`: what is left on each provider key, from the provider's own answer.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { endpointRows } from './endpoint.mjs';
import { fetchBalance } from '../model/balance.mjs';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const CRED = join(DSH_HOME, '.credentials.yaml');

/** Read a key from env first, then from the credentials store. Returns '' when missing. */
function keyOf(name) {
  const fromEnv = (process.env[name] || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const yaml = readFileSync(CRED, 'utf8');
    const m = yaml.match(new RegExp(`^\\s*${name}:\\s*["']?([^"'\\s]+)`, 'm'));
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/** Format a dollar amount: 4 decimals for small, 2 for large, sign before the symbol. */
const money = (usd) => {
  const abs = Math.abs(usd);
  return `${usd < 0 ? '-' : ''}$${abs < 1 ? abs.toFixed(4) : abs.toFixed(2)}`;
};

/**
 * The `/balance` card: remaining balance per provider, from each provider's own API.
 *
 * Returns a plain-text card listing each provider with its balance, or a hint when empty.
 * Accepts optional `rowsOf`, `keyOfImpl` and `fetchImpl` so a test can hand it a
 * profile of its own instead of reading the machine's.
 */
export async function balanceCard({ profile, lang, t, rowsOf = endpointRows, keyOfImpl = keyOf, fetchImpl } = {}) {
  let rows;
  try {
    rows = rowsOf(profile).filter((row) => row.baseURL);
  } catch {
    return t(lang, 'balance.none');
  }
  if (!rows.length) return t(lang, 'balance.none');
  const answers = await Promise.all(
    rows.map(async (row) => {
      const key = keyOfImpl(row.keyEnv);
      if (!key) return { row, kind: 'nokey' };
      const got = await fetchBalance({ baseUrl: row.baseURL, key, fetchImpl });
      return { row, kind: got.ok ? 'ok' : 'failed', got };
    }),
  );
  const lines = [t(lang, 'balance.head')];
  let anyEmpty = 0;
  let anyFailed = 0;
  for (const { row, kind, got } of answers) {
    if (kind === 'nokey') {
      lines.push(t(lang, 'balance.noKey', { provider: row.id }));
      continue;
    }
    if (kind === 'failed') {
      anyFailed += 1;
      lines.push(t(lang, 'balance.failed', { provider: row.id }));
      continue;
    }
    // The account is what actually pays. A key that ran past its own grant shows a
    // negative number while the account still serves, and calling that "empty" is
    // the mistake this card exists to stop. So when the router reports both, both
    // are printed and the account decides the verdict.
    const account = got.account && Number.isFinite(got.account.usd) ? got.account.usd : null;
    const effective = account === null ? got.usd : account;
    if (effective <= 0) {
      anyEmpty += 1;
      lines.push(t(lang, 'balance.empty', { provider: row.id }));
      continue;
    }
    if (account !== null) {
      lines.push(t(lang, 'balance.rowAccount', { provider: row.id, amount: money(account), key: money(got.usd) }));
      continue;
    }
    if (got.unlimited) {
      lines.push(t(lang, 'balance.unlimited', { provider: row.id }));
      continue;
    }
    lines.push(t(lang, 'balance.row', { provider: row.id, amount: money(effective) }));
  }
  if (anyEmpty || anyFailed) lines.push('', t(lang, 'balance.hint'));
  return lines.join('\n');
}
