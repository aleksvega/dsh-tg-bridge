// What the desktop app will update itself to.
//
// The app carries its own updater: `resources/app-update.yml` names a feed and a
// channel, and that feed's YAML names the newest build with its installer and
// hash. Reading it is the only way to answer "is the app current" with the
// number the app itself would act on — npm does not publish the shell at all,
// and the desktop repo's releases are a different line (0.13.x) that may sit
// ahead of the feed the installed app is subscribed to.
//
// Nothing here installs anything: it reads two public files and stops.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `url` and `channel` out of `app-update.yml`, or empty strings. */
export function parseUpdateConfig(text) {
  const read = (key) => {
    const m = new RegExp(`^${key}:\\s*['"]?([^'"\\s]+)['"]?\\s*$`, 'm').exec(String(text || ''));
    return m ? m[1] : '';
  };
  return { url: read('url'), channel: read('channel') };
}

/** Where the runtime asks for the channel's manifest: `nightly.yml`. */
export function feedUrl({ url = '', channel = '' } = {}) {
  if (!url) return '';
  const base = url.endsWith('/') ? url : `${url}/`;
  return `${base}${channel ? `${channel}.yml` : 'latest.yml'}`;
}

/** `version` and installer path out of an electron-builder feed file. */
export function parseFeed(text) {
  const body = String(text || '');
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(body)?.[1] || '';
  // The installer is written either inline or as a folded block (`url: >-`),
  // which is how this feed writes it.
  const installer = /^\s*(?:-\s*)?url:\s*>-?\s*\n\s*(\S+)/m.exec(body)?.[1]
    || /^\s*(?:-\s*)?url:\s*(\S+)/m.exec(body)?.[1]
    || '';
  const sha512 = /^\s*sha512:\s*>?-?\s*\n?\s*(\S+)/m.exec(body)?.[1] || '';
  const size = Number(/^\s*size:\s*(\d+)/m.exec(body)?.[1] || 0);
  return { version, installer, sha512, size };
}

function configFor(exe = '') {
  if (!exe) return '';
  const root = dirname(String(exe));
  for (const file of [join(root, 'resources', 'app-update.yml'), join(dirname(root), 'Resources', 'app-update.yml')]) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      // Try the next layout: Windows keeps the file beside the exe's resources,
      // macOS inside Contents/Resources.
    }
  }
  return '';
}

/** The plain text of a URL, or a thrown error the caller turns into "unknown". */
export async function fetchText(url, timeout = 8_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * The newest build the installed app's own updater knows about, or null.
 *
 * `fetchText` is injected so the tests do not need the network, and a feed that
 * cannot be reached answers null instead of a made-up version: "unknown" and
 * "current" must never read the same.
 */
export async function appUpdateInfo({ exe = '', fetchText: read = fetchText, timeout = 8_000 } = {}) {
  const cfg = parseUpdateConfig(configFor(exe));
  const target = feedUrl(cfg);
  if (!target || typeof read !== 'function') return null;
  try {
    const text = await read(target, timeout);
    const feed = parseFeed(text);
    if (!feed.version) return null;
    return { ...feed, channel: cfg.channel || '', feed: target };
  } catch {
    return null;
  }
}