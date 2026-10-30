// Finding a plugin from the chat, the way the desktop app's marketplace does.
//
// The registry already knows what a DSH plugin is: its package.json carries the
// `dsh-plugin` keyword. Searching that keyword is the whole implementation —
// there is no second index to keep in sync, and a package that installs by name
// is a package that can be found by name. A failed search is reported as a
// failure, never as "nothing found": the two mean different things to a person
// deciding whether their plugin exists.

const REGISTRY = 'https://registry.npmjs.org/-/v1/search';
const KEYWORD = 'keywords:dsh-plugin';

/**
 * Rows for the chat. `fetchImpl` is a parameter so the rule can be tested without
 * the network, the way every other decision in this bridge is.
 */
export async function searchPlugins(word, { limit = 8, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const text = [KEYWORD, String(word || '').trim()].filter(Boolean).join(' ');
  const url = `${REGISTRY}?text=${encodeURIComponent(text)}&size=${limit}`;
  let payload;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, status: res.status, rows: [], error: `HTTP ${res.status}` };
    payload = await res.json();
  } catch (error) {
    return { ok: false, status: 0, rows: [], error: String(error?.message || error) };
  }
  const rows = (payload?.objects || [])
    .map((entry) => entry?.package || {})
    .filter((pkg) => typeof pkg.name === 'string' && pkg.name.length > 0)
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version || '',
      description: String(pkg.description || '').replace(/\s+/g, ' '),
      date: String(pkg.date || '').slice(0, 10),
    }));
  return { ok: true, status: 200, rows, error: '' };
}

/** `name — one line`, cut to what a phone shows without wrapping twice. */
export function rowLine(row, installed = false) {
  const mark = installed ? '• ' : '';
  const version = row.version ? ` ${row.version}` : '';
  const about = String(row.description || '').trim().slice(0, 120);
  return `${mark}${row.name}${version}${about ? `\n   ${about}` : ''}`;
}

/**
 * One package, not a list: the answer to "what is this thing before I let it
 * into my profile". The registry serves the manifest under /latest, which is the
 * whole document minus the history.
 */
export async function pluginInfo(name, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const wanted = String(name || '').trim();
  if (!wanted) return { ok: false, status: 0, info: null, error: 'no name' };
  let res;
  try {
    res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(wanted)}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, status: 0, info: null, error: String(error?.message || error) };
  }
  if (res.status === 404) return { ok: false, status: 404, info: null, error: 'HTTP 404' };
  if (!res.ok) return { ok: false, status: res.status, info: null, error: `HTTP ${res.status}` };
  let pkg;
  try {
    pkg = await res.json();
  } catch (error) {
    return { ok: false, status: res.status, info: null, error: String(error?.message || error) };
  }
  const repo = pkg?.repository;
  return {
    ok: true,
    status: 200,
    error: '',
    info: {
      name: String(pkg?.name || wanted),
      version: String(pkg?.version || ''),
      description: String(pkg?.description || '').replace(/\s+/g, ' '),
      license: String(pkg?.license || ''),
      repository: String((typeof repo === 'string' ? repo : repo?.url) || '').replace(/^git\+/, ''),
      keywords: Array.isArray(pkg?.keywords) ? pkg.keywords.slice(0, 8).map(String) : [],
      // A DSH plugin is only a plugin when the manifest says so; the install
      // path checks the same field, so the card must not promise more.
      bundle: Boolean(pkg?.dsh && pkg.dsh.bundle),
      engines: pkg?.engines?.dsh ? String(pkg.engines.dsh) : '',
    },
  };
}

/**
 * Version order for "is there anything newer". A prerelease sorts below its own
 * release, which is the only case that matters here: 1.2.0-rc.1 is not an update
 * over 1.2.0.
 */
export function isNewer(candidate, current) {
  const split = (v) => {
    const [core, pre = ''] = String(v || '').trim().replace(/^v/, '').split('-');
    const nums = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const a = split(candidate);
  const b = split(current);
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  }
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre > b.pre;
}
