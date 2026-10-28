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
 * The provider this install answers through first: its base URL and the name of
 * the env var holding its key, read from the profile the bridge runs with.
 *
 * Nothing is hardcoded here on purpose. A probe against a host the bot does not
 * use reports the wrong fault — "your key is rejected" when the key was never
 * meant for that host — and a wrong answer is worse than no answer.
 */
let cachedProvider;
export function firstProvider() {
  if (cachedProvider !== undefined) return cachedProvider;
  const profile = process.env.DSH_PROFILE || 'headless';
  let patch = '';
  try {
    patch = readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
  } catch {
    cachedProvider = null;
    return cachedProvider;
  }
  const lines = patch.split('\n');
  const at = lines.findIndex((line) => /^\s*providers:\s*$/.test(line));
  const found = { baseUrl: '', keyEnv: '' };
  if (at >= 0) {
    // The first provider block: both fields belong to the row the bot tries
    // first, which is the one a verdict is about.
    for (let i = at + 1; i < lines.length; i += 1) {
      if (/^\S/.test(lines[i])) break;
      const base = lines[i].match(/^\s+baseURL:\s*["']?([^"'\s]+)/);
      if (base && !found.baseUrl) found.baseUrl = base[1].replace(/\/+$/, '');
      const key = lines[i].match(/^\s+apiKeyEnv:\s*["']?([^"'\s]+)/);
      if (key && !found.keyEnv) found.keyEnv = key[1];
      if (found.baseUrl && found.keyEnv) break;
    }
  }
  // The profile row is the source of truth. These two overrides exist for the
  // one case the file cannot describe — pointing the probe at a different host
  // while debugging — and they carry no provider name, because the package is
  // public and a name here would ship someone's vendor with it.
  const baseUrl = (process.env.DSH_PROBE_BASE_URL || found.baseUrl || '').trim().replace(/\/+$/, '');
  const keyEnv = (process.env.DSH_PROBE_KEY_ENV || '').trim() || found.keyEnv;
  cachedProvider = baseUrl ? { baseUrl, keyEnv } : null;
  return cachedProvider;
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
 */
async function probeModel(model, { timeoutMs = 15000 } = {}) {
  const provider = firstProvider();
  if (!provider) return { model, ok: false, kind: 'unknown', detail: 'no provider base url in this profile' };
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

/** First channel that answers, or null. Probes run in order, so the cheapest wins. */
async function firstLiveModel(models) {
  const seen = new Set();
  const verdicts = [];
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const verdict = await probeModel(model);
    verdicts.push(verdict);
    if (verdict.ok) return { live: verdict, verdicts };
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
