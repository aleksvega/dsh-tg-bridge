// Live model probe.
//
// A turn that ends with "all models are unavailable" is useless on its own: the
// person cannot tell an exhausted balance from a provider that is merely busy,
// and the bridge used to burn 12 minutes before saying it. One tiny request per
// channel answers that question in seconds, and a channel that answers can be
// used for one more attempt instead of giving up.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const CRED = join(DSH_HOME, '.credentials.yaml');

function secret(name) {
  if (!name) return '';
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

/**
 * Split the `providers:` block of a profile patch into rows: `{id, lines}`.
 *
 * The file is hand-written YAML with a fixed shape — `providers:` at two spaces,
 * a provider id at six, its fields deeper — and a full YAML parser would be a
 * dependency for four fields. The row indent is read from the first child line
 * rather than assumed, so a reformatted profile still parses.
 */
export function providerRows(patch) {
  const lines = String(patch || '').split('\n');
  const at = lines.findIndex((line) => /^\s*providers:\s*$/.test(line));
  if (at < 0) return [];
  const firstChild = lines.slice(at + 1).find((line) => line.trim() && !/^\s*#/.test(line));
  const rowIndent = (/^(\s*)/.exec(firstChild || '')?.[1] || '').length;
  const rows = [];
  let current = null;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*#/.test(line)) {
      if (current) current.lines.push(line);
      continue;
    }
    const depth = (/^(\s*)/.exec(line)[1] || '').length;
    // The block ends at the first line shallower than a provider row.
    if (depth < rowIndent) break;
    const row = depth === rowIndent ? /^\s*([\w.-]+):\s*$/.exec(line) : null;
    if (row) {
      current = { id: row[1], lines: [] };
      rows.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return rows;
}

/**
 * One provider row from the profile the bridge runs with: base URL, the env var
 * holding its key, and the API shape it speaks.
 *
 * Nothing is hardcoded here on purpose. A probe against a host the bot does not
 * use reports the wrong fault — "your key is rejected" when the key was never
 * meant for that host — and a wrong answer is worse than no answer.
 *
 * With one router in the chain a single row described every attempt. A chain
 * that mixes companies has a row per company, and asking provider A about
 * provider B's model is the same wrong answer as asking a host the bot never
 * uses, so the caller names the provider and gets that row.
 *
 * @param {string} [wanted] provider id as the profile writes it; empty = first
 */
const providerCache = new Map();
export function providerFor(wanted = '') {
  const id = String(wanted || '').trim();
  if (providerCache.has(id)) return providerCache.get(id);
  const profile = process.env.DSH_PROFILE || 'headless';
  let patch = '';
  try {
    patch = readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
  } catch {
    providerCache.set(id, null);
    return null;
  }
  const found = { id: '', baseUrl: '', keyEnv: '', api: '' };
  // Every provider row in the block: its id, its indent, and the lines under it.
  for (const row of providerRows(patch)) {
    if (id && row.id !== id) continue;
    found.id = row.id;
    for (const line of row.lines) {
      const base = line.match(/^\s+baseURL:\s*["']?([^"'\s]+)/);
      if (base && !found.baseUrl) found.baseUrl = base[1].replace(/\/+$/, '');
      const key = line.match(/^\s+apiKeyEnv:\s*["']?([^"'\s]+)/);
      if (key && !found.keyEnv) found.keyEnv = key[1];
      const api = line.match(/^\s+api:\s*["']?([^"'\s]+)/);
      if (api && !found.api) found.api = api[1];
    }
    break;
  }
  // The profile row is the source of truth. These two overrides exist for the
  // one case the file cannot describe — pointing the probe at a different host
  // while debugging — and they carry no provider name, because the package is
  // public and a name here would ship someone's vendor with it.
  const baseUrl = (process.env.DSH_PROBE_BASE_URL || found.baseUrl || '').trim().replace(/\/+$/, '');
  const keyEnv = (process.env.DSH_PROBE_KEY_ENV || '').trim() || found.keyEnv;
  const provider = baseUrl ? { id: found.id, baseUrl, keyEnv, api: found.api } : null;
  providerCache.set(id, provider);
  return provider;
}

/** The provider the install answers through first: the profile's first row. */
export function firstProvider() {
  return providerFor('');
}

/** Classify a provider answer into something the chat can act on. */
function classify(status, body) {
  const text = String(body || '');
  if (status === 200) return 'ok';
  if (/insufficient_user_quota|balance|billing|payment/i.test(text)) return 'balance';
  if (/get_channel_failed|all providers|rate limit|busy/i.test(text)) return 'busy';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'missing';
  return 'other';
}

/**
 * One 1-token completion. `ok` means the channel really answers for this
 * account right now — not just that the name exists.
 *
 * `provider` names whose route to ask: with a single router the profile's first
 * row answered for every model, but a chain that mixes companies must ask the
 * company that owns the model — otherwise the verdict describes a host that was
 * never tried, and a working route gets skipped for someone else's 503.
 */
async function probeModel(model, { timeoutMs = 15000, provider: wanted = '' } = {}) {
  const provider = providerFor(wanted);
  if (!provider) {
    return { model, ok: false, kind: 'unknown', detail: wanted ? `no provider ${wanted} in this profile` : 'no provider base url in this profile' };
  }
  const key = secret(provider.keyEnv);
  if (!key) return { model, ok: false, kind: 'auth', detail: `${provider.keyEnv || 'the key'} is missing` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: controller.signal,
    });
    const body = await response.text();
    const kind = classify(response.status, body);
    return {
      model,
      ok: kind === 'ok',
      kind,
      status: response.status,
      detail: kind === 'ok' ? '' : body.slice(0, 200),
    };
  } catch (error) {
    return { model, ok: false, kind: 'network', detail: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * First channel that answers, or null. Probes run in order, so the cheapest wins.
 *
 * Entries are `{model, provider}`: the same model name can exist on two routers,
 * and probing one of them twice would burn a request to learn nothing.
 */
async function firstLiveModel(models) {
  const seen = new Set();
  const verdicts = [];
  for (const item of models) {
    const model = typeof item === 'string' ? item : item?.model;
    const provider = typeof item === 'string' ? '' : item?.provider || '';
    if (!model) continue;
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const verdict = await probeModel(model, { provider });
    verdicts.push({ ...verdict, provider });
    if (verdict.ok) return { live: { ...verdict, provider }, verdicts };
  }
  return { live: null, verdicts };
}

/** Short human line for the failure message: what is actually wrong. */
function describeVerdicts(verdicts) {
  const kinds = new Set(verdicts.map((v) => v.kind));
  if (kinds.has('balance')) return 'balance';
  if (kinds.has('busy')) return 'busy';
  if (kinds.has('auth')) return 'auth';
  if (kinds.has('network')) return 'network';
  return 'unknown';
}

/**
 * What to tell the person once the probe has a verdict. The old version glued
 * the verdict onto a raw provider string, and the message opened with the tail
 * of an English error ("...balance" + "in"). The verdict is the message.
 */
function probeHint(kind, lang = 'ru') {
  const text = {
    balance: {
      ru: 'Баланс провайдера пуст: проба вернула 403 «недостаточно средств». Пополни счёт или переключись на free-модель через /model.',
      en: 'The provider balance is empty: the probe got a 403 "insufficient funds". Top up, or switch to a free model with /model.',
      zh: '提供商余额为空：探测返回 403「余额不足」。请充值，或用 /model 切换到免费模型。',
    },
    busy: {
      ru: 'Провайдер перегружен: все каналы отдают 503. Это не баланс — повтори через пару минут.',
      en: 'The provider is overloaded: every channel answers 503. Not a balance problem — try again in a few minutes.',
      zh: '提供商过载：所有通道都返回 503。不是余额问题——过几分钟再试。',
    },
    auth: {
      ru: 'Ключ не принят: провайдер вернул 401/403. Проверь ~/.dsh/.credentials.yaml.',
      en: 'The key was rejected: the provider answered 401/403. Check ~/.dsh/.credentials.yaml.',
      zh: '密钥未被接受：提供商返回 401/403。请检查 ~/.dsh/.credentials.yaml。',
    },
    network: {
      ru: 'Сеть не отвечает: проба не достучалась до провайдера. Проверь VPN и IPv4.',
      en: 'The network does not answer: the probe could not reach the provider. Check VPN and IPv4.',
      zh: '网络无响应：探测无法连接提供商。请检查 VPN 和 IPv4。',
    },
  };
  return text[kind]?.[lang] ?? text[kind]?.ru ?? '';
}

export { probeModel, firstLiveModel, describeVerdicts, probeHint };
