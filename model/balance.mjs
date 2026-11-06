// What is left on a provider key, asked from the provider instead of guessed
// from an error message.
//
// The chat used to say "the balance is empty" on a 403, and that sentence was a
// guess: one router answers 403 both for an empty account and for a key that
// may not use the model, so a person either topped up a working account or
// waited for a limit that was never the problem. One GET answers with a number,
// and a number is something the person can act on.
//
// No provider is named here: the paths below are the ones the common router
// implementations answer on, and whichever answers first is remembered for the
// rest of the process. An unknown host costs the same five requests once.

/** Quota units per currency unit: the convention every one-api style router ships with. */
export const QUOTA_PER_USD = 500000;

/** Where a router keeps the account's remaining credit, cheapest answer first. */
export const BALANCE_PATHS = ['/api/usage/token/', '/v1/credits', '/v1/balance', '/v1/usage', '/user/balance'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The remaining amount from whatever shape a router answered with.
 *
 * Returns `{ usd, unlimited, kind, left, granted, account }` when recognized, `null` otherwise.
 * - `kind`: 'quota' for new-api token accounting (total_available / 500000 = usd), 'usd' for direct dollar values.
 * - `left`: raw remaining value for this key.
 * - `granted`: total granted to this key (quota systems only).
 * - `account`: the same key's router also reports the whole account next to it. The two
 *   disagree often — a key can run past its grant and show a negative number while the
 *   account still holds money and keeps serving. Reporting only the key taught people to
 *   top up an account that was not empty, so both numbers travel together.
 */
export function parseBalance(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const accountQuota = data.user_quota && typeof data.user_quota === 'object' ? num(data.user_quota.total_available) : null;
  const account = accountQuota === null ? null : { usd: accountQuota / QUOTA_PER_USD, left: accountQuota };
  const quota = num(data.total_available);
  if (quota !== null && num(data.total_granted) !== null) {
    return { usd: quota / QUOTA_PER_USD, unlimited: data.unlimited_quota === true, kind: 'quota', left: quota, granted: num(data.total_granted), account };
  }
  for (const field of ['balance', 'credits', 'remaining', 'available', 'credit']) {
    const value = num(data[field]);
    if (value !== null) return { usd: value, unlimited: false, kind: 'usd', left: value, granted: null, account };
  }
  return null;
}

const knownPath = new Map();

/**
 * The roots worth asking: a profile stores the chat base (`…/v1`), while the
 * accounting routes usually sit on the host root. Both are tried, root first.
 */
function rootsOf(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const cut = base.match(/^(.*?)(\/v\d+)$/i);
  return cut ? [cut[1], base] : [base];
}

/**
 * Query a provider for the remaining balance on a key.
 *
 * Tries standard router paths until one answers with a recognized shape.
 * Remembers which path worked per baseUrl for the rest of the process.
 *
 * Returns `{ ok: true, path, usd, unlimited, kind, left, granted }` on success,
 * or `{ ok: false, why, detail? }` when none of the paths answered or the network failed.
 */
export async function fetchBalance({ baseUrl, key, timeoutMs = 6000, fetchImpl = fetch, paths = BALANCE_PATHS } = {}) {
  const roots = rootsOf(baseUrl);
  if (!roots[0] || !key) return { ok: false, why: 'nokey' };
  const remembered = knownPath.get(roots[0]);
  const order = remembered ? [remembered, ...paths.filter((p) => p !== remembered)] : paths;
  for (const root of roots) {
    for (const path of order) {
      let response;
      try {
        response = await fetchImpl(`${root}${path}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return { ok: false, why: 'network', detail: error.message };
      }
      if (!response.ok) continue;
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        continue;
      }
      const found = parseBalance(payload);
      if (found) {
        knownPath.set(roots[0], path);
        return { ok: true, path, root, ...found };
      }
    }
  }
  return { ok: false, why: 'noendpoint' };
}
