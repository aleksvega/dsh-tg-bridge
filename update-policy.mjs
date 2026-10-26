// Version policy: the npm tag `latest` is a label, not an updater. Nothing on a
// machine moves to a new release unless something moves it — `npx` on a fresh
// run, `npm i -g`, or a scheduled job. This module is the decision half of that
// (what to do about a release), kept apart from the bridge so it can be tested
// without a bot, a network or a profile.
//
// Modes, one per install (a global setting, because it is the install that
// updates, not a topic):
//
//   off   never touch the files; `/version` still reports whether a release exists
//   check notice once per new version, never update on its own (the default)
//   auto  fetch and install a new release on its own; the person restarts
//
// In every mode the running process keeps its modules until `/restart confirm`:
// an update that replaced files under a live turn would be the one change nobody
// can debug. So "auto" means "the files are already new when you say restart".

/** Modes a person can pick, in the order `/update` lists them. */
export const UPDATE_MODES = ['off', 'check', 'auto'];

/**
 * The version the bridge should run: the newest published one that is not newer
 * than the line this install was made for.
 *
 * Version 1 of this policy is just "the published latest". The shape is here
 * because the alternative — always taking `latest` — is what hands a person a
 * 0.3.0 prerelease the day it appears, and the pin has to live in the stored
 * version string (this bridge's own version), not in a second field nobody
 * remembers to bump.
 */
export function targetVersion(latest) {
  return latest || '';
}

/** Compare two dotted versions; 1 when a > b, -1 when a < b, 0 when equal. */
export function compareVersions(a = '', b = '') {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * What `/version` (or a notice) should say about where this install stands.
 *
 * Inputs are the stored settings and the numbers we could get; the answer never
 * promises a network call succeeded when it did not, because "you are up to
 * date" printed offline is worse than "could not check".
 */
export function updateState({ installed = '', latest = '', mode = 'check', notified = '', checkedAt = 0, now = Date.now() }) {
  const result = { mode: UPDATE_MODES.includes(mode) ? mode : 'check', installed, latest, behind: false, notify: false, auto: false };
  if (!latest) return result; // npm unreachable: nothing is known, nothing changes
  const target = targetVersion(latest);
  result.target = target;
  const cmp = installed ? compareVersions(target, installed) : 1;
  result.behind = cmp > 0;
  // One notice per version, and never the version already running.
  result.notify = result.behind && notified !== target && result.mode !== 'off';
  result.auto = result.behind && result.mode === 'auto';
  result.checkedAt = checkedAt || now;
  return result;
}

/**
 * How often to ask npm, per mode. A release is not a second-to-second event and
 * `npm view` is a network round trip from a machine that may be on a slow link,
 * so hourly for auto is often enough; the ordinary install is asked once a day.
 */
export function checkIntervalMs(mode = 'check') {
  if (mode === 'off') return 0;
  if (mode === 'auto') return 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/** Should a check run now? */
export function dueForCheck({ mode = 'check', checkedAt = 0, now = Date.now() }) {
  const interval = checkIntervalMs(mode);
  return interval > 0 && now - checkedAt >= interval;
}

/** One line for `/version`, no markdown (the bridge sends plain text). */
export function describeUpdate(state) {
  const { installed, target, mode, latest } = state;
  const have = installed ? `installed ${installed}` : 'installed version unknown';
  if (!latest) return `${have}; the registry did not answer, so a newer release is unknown.`;
  if (!state.behind) return `${have}; ${target} is the newest published one.`;
  const how =
    mode === 'auto'
      ? `auto-update is on: ${latest} installs by itself, then /restart confirm loads it`
      : mode === 'off'
        ? 'notices are off: /update on turns them on, /update confirm installs it now'
        : `a notice appears once: /update off turns notices off, /update confirm installs it now`;
  return `${have}, ${latest} is out. ${how}.`;
}

/**
 * What `/update on|off|check|auto` has to do to leave the install where the
 * person asked it to be.
 *
 * Two switches, on purpose: `on|off` is the notice ("tell me about releases"),
 * `check|auto` is the means ("or install them yourself"). Both leave the version
 * on disk alone — installing is `confirm`, and only `confirm` — so there is no
 * way for "stop telling me" to be read as "and also move me somewhere".
 */
export function modeChange({ installed = '', latest = '', command = '' } = {}) {
  if (command === 'off') {
    return { store: { mode: 'off', pinned: installed }, text: 'notices are off; this install stays where it is. /update on brings them back, /update confirm installs an update by hand' };
  }
  if (command === 'on' || command === 'check') {
    const more = latest && installed && compareVersions(installed, latest) < 0 ? ', and one notice is due for it' : '';
    return { store: { mode: 'check', pinned: '', notified: '' }, text: `notices are on: one message per new release${more}; nothing installs by itself` };
  }
  if (command === 'auto') {
    return { store: { mode: 'auto', pinned: '' }, text: 'notices are on and new releases also install by themselves; /restart confirm loads them' };
  }
  if (command === 'manual') {
    return { store: { mode: 'check', pinned: installed }, text: `stays on ${installed || 'the current version'}; /update confirm installs a newer one when you ask` };
  }
  return { store: null, text: 'use: /update (status) · on · off · auto · confirm', invalid: true };
}

/** Storage shape for the settings file, so callers agree on one place. */
export const UPDATE_DEFAULTS = { mode: 'check', notified: '', checkedAt: 0, pinned: '' };