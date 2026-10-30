// Which release this install may trust, and what to do when it turns out it
// cannot.
//
// 1.30.0 shipped with a call to a function that did not exist. Nothing caught it
// before the restart: the file parsed, every import resolved, 588 tests passed.
// It failed on the first real message, and the person was left on a version that
// answered nothing — the exact outcome an update is supposed to rule out.
//
// A static check cannot see a name that is never defined inside a function body.
// The only honest test is a turn that runs, so this module keeps the result of
// that test per version:
//
//   proven   this version answered a real turn — the code that matters works
//   faulted  it threw a code fault (a name that is not defined, a module that
//            does not export what it promises) and not a provider or network
//            error, which says nothing about the release
//   unknown  installed, never ran
//
// Two faults on a version that has never answered, while a proven version is
// still on record, is the condition for going back. One is a fluke; two is the
// release. And a provider error is never counted: rolling back because a balance
// ran out would move a working install for a reason that has nothing to do with
// the code.
import { writeFileSync } from 'node:fs';
import { bridgeVersion, installRelease, newestUpdateBackup, restoreUpdateBackup } from './control/release.mjs';
import { RESTART_MARKER } from './paths.mjs';

/** Faults needed before a never-proven version is considered broken. */
export const FAULT_LIMIT = 2;

/**
 * How long after a rollback a second one is refused.
 *
 * The files on disk go back to the proven release, but the process that is
 * running them is still the broken one until it exits — and it can serve several
 * more messages before the queue drains. Without a cooldown each of those would
 * fetch, restore and announce the same rollback again.
 */
export const ROLLBACK_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Errors that are the release's fault, not the world's.
 *
 * Each of these means the code that shipped is wrong: a name it never defined, a
 * module that does not export what it imports, a file that does not parse. The
 * list is deliberately narrow — a 402, a 429, a timeout and "all providers are
 * busy" all reach a turn as errors too, and none of them is a verdict on 1.30.0.
 */
const CODE_FAULT = new RegExp([
  'is not defined',
  'is not a function',
  'is not a constructor',
  'is not iterable',
  'Cannot read propert',
  'Cannot find module',
  'does not provide an export',
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_INVALID_MODULE_SPECIFIER',
  'SyntaxError',
  'Unexpected token',
  'Unexpected end of input',
].join('|'), 'i');

/** True when this error text blames the code that is running. */
export function isCodeFault(text) {
  return CODE_FAULT.test(String(text || ''));
}

/**
 * The release record, created on first use.
 *
 * `state.release` is one install-wide object: a version is proven or broken for
 * the machine, not for a topic, and two topics must not disagree about whether
 * the same files work.
 */
export function releasesOf(state) {
  if (!state.release || typeof state.release !== 'object') state.release = {};
  const release = state.release;
  if (!release.proven || typeof release.proven !== 'object') release.proven = {};
  if (!release.faults || typeof release.faults !== 'object') release.faults = {};
  if (typeof release.lastGood !== 'string') release.lastGood = '';
  return release;
}

/** What is known about one version: `proven`, `faulted` or `unknown`. */
export function verdictOf(state, version) {
  if (!version) return 'unknown';
  const release = releasesOf(state);
  if (release.proven[version]) return 'proven';
  if (Number(release.faults[version]) > 0) return 'faulted';
  return 'unknown';
}

/**
 * Record how a finished turn reflects on the running release.
 *
 * Called once per turn, from the two places a turn can end. Returns what the
 * caller should do about it: `rollback` is the version to go back to, or ''.
 *
 * @param {object} state the install's state object (mutated)
 * @param {{version?: string, error?: string, at?: number}} turn
 * @returns {{verdict: 'proven'|'fault'|'neutral', faults: number, rollback: string, from: string}}
 */
export function noteOutcome(state, turn = {}) {
  const release = releasesOf(state);
  const version = turn.version || bridgeVersion();
  const at = Number(turn.at) || Date.now();
  const from = version;
  if (!version) return { verdict: 'neutral', faults: 0, rollback: '', from };

  if (!turn.error) {
    // An answered turn is the proof a static check cannot give.
    const before = release.proven[version];
    release.proven[version] = { at, turns: (Number(before?.turns) || 0) + 1 };
    release.lastGood = version;
    // A version that recovered is not faulted any more: one bad turn after a
    // provider hiccup must not leave a permanent mark on a release that works.
    delete release.faults[version];
    return { verdict: 'proven', faults: 0, rollback: '', from };
  }
  if (!isCodeFault(turn.error)) return { verdict: 'neutral', faults: Number(release.faults[version]) || 0, rollback: '', from };

  const faults = (Number(release.faults[version]) || 0) + 1;
  release.faults[version] = faults;
  release.faultedAt = at;
  release.faultedVersion = version;
  // Never proven, and the previous release is still on record: the install has
  // somewhere better to be. A rollback that just happened is not repeated for a
  // turn that started before it.
  const candidate = release.lastGood && release.lastGood !== version ? release.lastGood : '';
  const cooling = Number(release.rolledBackAt) > 0 && at - Number(release.rolledBackAt) < ROLLBACK_COOLDOWN_MS;
  const rollback = faults >= FAULT_LIMIT && !release.proven[version] && candidate && !cooling ? candidate : '';
  // Remembered here, not only in applyRollback: the process running the broken
  // code keeps serving turns until it exits, and each would ask again.
  if (rollback) release.rolledBackAt = at;
  return { verdict: 'fault', faults, rollback, from };
}

/**
 * Should a start be abandoned in favour of the last proven release?
 *
 * The turn path cannot answer this one: a release that throws while it loads
 * never runs a turn, so nothing is recorded and `noteOutcome` never fires. The
 * supervisor tick is the only thing watching that case, and it needs the same
 * rule rather than a second copy of it — which is why the decision lives here,
 * as a pure function over the state it can read.
 *
 * `crashLoop` is the tick's own evidence: several starts in a row, each followed
 * by a dead process. It counts the same way one recorded fault does, because
 * from the outside "it died three times without answering" and "it threw twice"
 * are the same fact — this install is not working.
 *
 * @param {object} state
 * @param {string} installed version on disk
 * @param {{crashLoop?: boolean, at?: number}} [evidence]
 * @returns {string} the version to go back to, or '' to start as it is
 */
export function startupRollback(state, installed, evidence = {}) {
  const release = releasesOf(state);
  const at = Number(evidence.at) || Date.now();
  if (!installed || !release.lastGood) return '';
  // The version already on record as good is not a rollback target.
  if (release.lastGood === installed) return '';
  // A version that answered once works; a bad start later is not the release.
  if (release.proven[installed]) return '';
  // The supervisor keeps its own stamp, separate from the turn path's: the two
  // run on different clocks, and a tick that just restored the files must not do
  // it again a minute later while the start it triggered is still failing.
  if (Number(release.startupRolledBackAt) > 0 && at - Number(release.startupRolledBackAt) < ROLLBACK_COOLDOWN_MS) return '';
  const faults = Number(release.faults[installed]) || 0;
  if (faults >= FAULT_LIMIT || evidence.crashLoop) return release.lastGood;
  return '';
}

/**
 * Keep the last failure for `/report`, and the reason a rollback happened.
 *
 * Moved out of `handle-message.mjs` when the release record needed the same
 * information: the person who asks for a bug report is usually the one who just
 * saw the failure, and asking them to reproduce it first is how a report never
 * gets written.
 */
export function recordFailure(state, key, info = {}) {
  if (!state.lastFailure || typeof state.lastFailure !== 'object') state.lastFailure = {};
  state.lastFailure[key] = {
    at: new Date().toISOString(),
    error: String(info.error || '').slice(0, 2000),
    model: info.model || '',
    tools: Array.isArray(info.tools) ? info.tools : [],
    cwd: info.cwd || '',
    seconds: Number(info.seconds) || 0,
    version: info.version || '',
  };
  return state.lastFailure[key];
}

/**
 * Go back to a proven release: fetch it from npm, or restore the newest copy the
 * last update saved when the registry is not reachable.
 *
 * Returns what happened, in facts the caller turns into one sentence — never a
 * promise that the rollback worked before it did.
 *
 * @param {string} version
 * @param {{install?: Function, backup?: Function}} [deps] for tests
 * @returns {{ok: boolean, version: string, via: 'npm'|'backup'|'', problems: string[]}}
 */
export function rollbackRelease(version, deps = {}) {
  if (!version) return { ok: false, version: '', via: '', problems: ['no version to go back to'] };
  const install = deps.install || installRelease;
  const problems = [];
  try {
    const result = install(version);
    if (result?.rolledBack) {
      // The release we were going back to would not load either: keep the files
      // where they are and say why, instead of stacking one broken install on
      // another.
      return { ok: false, version, via: 'npm', problems: result.problems || [] };
    }
    return { ok: true, version, via: 'npm', problems: [] };
  } catch (error) {
    problems.push(String(error?.message ?? error).slice(0, 200));
  }
  const backup = deps.backup || newestUpdateBackup;
  const restore = deps.restore || restoreUpdateBackup;
  const dir = backup();
  if (!dir) return { ok: false, version, via: '', problems };
  try {
    restore(dir);
    return { ok: true, version, via: 'backup', problems };
  } catch (error) {
    problems.push(String(error?.message ?? error).slice(0, 200));
    return { ok: false, version, via: 'backup', problems };
  }
}

/**
 * One line of fact about a version, for `/update` and for the rollback notice.
 *
 * Data, not prose: the words live in the three locale tables, and a module that
 * builds sentences is a module that has to be edited three times for one change.
 */
export function releaseFacts(state, installed = '') {
  const release = releasesOf(state);
  const version = installed || bridgeVersion();
  return {
    version,
    verdict: verdictOf(state, version),
    turns: Number(release.proven[version]?.turns) || 0,
    provenAt: Number(release.proven[version]?.at) || 0,
    faults: Number(release.faults[version]) || 0,
    lastGood: release.lastGood || '',
    canRollBack: Boolean(release.lastGood && release.lastGood !== version),
  };
}

/**
 * Everything a finished turn says about the release it ran on.
 *
 * One call per turn, from the two places a turn can end, so the two branches can
 * never disagree about what "this version works" means. Returns the verdict; a
 * rollback, when it happens, has already been announced in the chat and the
 * restart marker has been written, so the caller only has to save the state.
 *
 * Never throws: the record of a release is not worth losing the answer that is
 * about to be sent.
 */
export async function noteTurn(state, info = {}) {
  const { key = '', error = '', model = '', tools = [], cwd = '', seconds = 0, saveState } = info;
  // Read once per turn: an update may have replaced the files, and a version
  // that is on disk but not yet loaded must not be credited with this turn.
  const version = info.version || bridgeVersion();
  let outcome = { verdict: 'neutral', faults: 0, rollback: '', from: version };
  try {
    if (error) recordFailure(state, key, { error, model, tools, cwd, seconds, version });
    outcome = noteOutcome(state, { version, error, at: Number(info.at) || Date.now() });
    if (outcome.rollback) await applyRollback(state, { ...info, version: outcome.rollback });
  } catch (failure) {
    if (typeof info.log === 'function') info.log(`release record skipped: ${String(failure?.message ?? failure).slice(0, 200)}`);
    return outcome;
  }
  // Saving is a separate failure mode: a full disk must not lose the verdict, and
  // must not fail the turn either.
  try {
    if (typeof saveState === 'function') saveState();
  } catch (failure) {
    if (typeof info.log === 'function') info.log(`release state not saved: ${String(failure?.message ?? failure).slice(0, 200)}`);
  }
  return outcome;
}

/**
 * Go back to the last proven release and let the supervisor load it.
 *
 * The files are restored on disk, and `restart.pending` is written instead of
 * calling `process.exit`: the bridge exits when its queue is empty, so the turn
 * that discovered the fault still finishes and answers. Nothing is killed
 * mid-sentence, and the person gets a message about it either way.
 *
 * @param {object} state
 * @param {object} deps everything that touches the outside world
 * @returns {Promise<{ok: boolean, to: string, via: string, text: string}>}
 */
export async function applyRollback(state, deps = {}) {
  const { version = '', lang = 'en', t = (_, key) => key, log = () => {}, chatId = 0, threadId = 0, at = Date.now() } = deps;
  const send = deps.send || (async () => {});
  const release = releasesOf(state);
  const target = version || release.lastGood;
  if (!target) return { ok: false, to: '', via: '', text: '' };
  const result = rollbackRelease(target, deps);
  // Only a rollback that happened starts the cooldown: one that failed (registry
  // down, no backup) is worth retrying on the next turn.
  if (result.ok) release.rolledBackAt = at;
  release.history = [
    ...(Array.isArray(release.history) ? release.history : []),
    { from: release.faultedVersion || '', to: target, at, via: result.via, ok: result.ok },
  ].slice(-5);
  const text = result.ok
    ? t(lang, result.via === 'backup' ? 'rel.rolledBackBackup' : 'rel.rolledBack', { v: release.faultedVersion || '?', to: target })
    : t(lang, 'rel.rollbackFailed', { v: target, why: (result.problems[0] || '').slice(0, 200) });
  if (result.ok) {
    // Ask for the restart, do not perform it: the supervisor starts the restored
    // files only once nothing is in flight, which is what keeps this turn's
    // answer from being the last thing the person ever sees.
    try {
      writeFileSync(RESTART_MARKER, JSON.stringify({ at, from: release.faultedVersion || '', to: target }), 'utf8');
    } catch (error) {
      log(`rollback restart marker not written: ${String(error?.message ?? error).slice(0, 120)}`);
    }
  }
  log(`rollback ${result.ok ? 'done' : 'failed'} to ${target} via ${result.via || 'nothing'}${result.problems.length ? ` :: ${result.problems.join(' | ').slice(0, 300)}` : ''}`);
  if (chatId) {
    try {
      await send(chatId, text, threadId);
    } catch (error) {
      log(`rollback notice not sent: ${String(error?.message ?? error).slice(0, 120)}`);
    }
  }
  return { ok: result.ok, to: target, via: result.via, text, problems: result.problems };
}
