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
      ? `auto-update is on: ${latest} will be installed, then /restart confirm loads it`
      : mode === 'off'
        ? 'auto-update is off: /update confirm installs it'
        : `notified once: /update on turns the notice off, /update confirm installs it`;
  return `${have}, ${latest} is out. ${how}.`;
}

/**
 * What `/update on|off|check` has to do to leave the install where the person
 * asked it to be.
 *
 * One rule, said plainly: `off` and `on` mean "stay on the version I have now",
 * because only an install that is already up to date would otherwise read the
 * switch as "stop telling me, and also never update". Going back to following
 * releases is `npm i -g dsh-tg-bridge@latest` or `npx dsh-tg@latest setup` — the
 * command that also proves the new version starts.
 */
export function modeChange({ installed = '', latest = '', command = '' } = {}) {
  if (command === 'off') {
    return {
      store: { mode: 'off', pinned: installed, notified: latest },
      text: `update checks are off; this install stays on ${installed || 'its current version'}${latest && latest !== installed ? `, and ${latest} is waiting for /update confirm` : ''}`,
    };
  }
  if (command === 'check') return { store: { mode: 'check', pinned: '', notified: '' }, text: 'a notice appears once per new version; nothing installs by itself' };
  if (command === 'auto') {
    // Only an install already on the newest release can follow releases again:
    // switching the policy on top of an old version would mean two updates at
    // once, one of them unattended.
    if (latest && installed && compareVersions(installed, latest) < 0) {
      return { store: null, text: `this install is still on ${installed}; run /update confirm first, then /update auto` };
    }
    return { store: { mode: 'auto', pinned: '', notified: '' }, text: 'new releases install by themselves; /restart confirm loads them' };
  }
  return { store: null, text: 'use: /update (status) · off · check · auto · confirm', invalid: true };
}

/** Storage shape for the settings file, so callers agree on one place. */
export const UPDATE_DEFAULTS = { mode: 'check', notified: '', checkedAt: 0, pinned: '' };