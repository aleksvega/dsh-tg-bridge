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
