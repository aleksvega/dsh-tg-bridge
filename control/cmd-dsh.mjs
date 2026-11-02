// `/dsh` — which harness is installed, which one npm has, and whether this
// bridge was ever tested against it.
//
// The three facts come from three places (`dsh --version`, npm's registry, and
// this package's own engines range), and the point of the card is that the third
// one is a claim someone can check. A version outside the range is a warning,
// never a block: DSH moves faster than this bridge is re-tested, and refusing to
// run would be a lie about how much is known.
import { spawn } from 'node:child_process';

import { t } from '../core/i18n.mjs';
import { dshLaunch } from '../core/dsh-launch.mjs';
import { appUpdateInfo } from '../core/app-feed.mjs';
import { downloadDir, downloadInstaller, formatSize, launchInstaller } from '../core/app-install.mjs';
import { appDshVersion, dshStatus, forgetInstalledDsh, installedDsh, latestDsh } from '../core/dsh-version.mjs';

/**
 * Which version is "the newest", and where that number came from.
 *
 * For a CLI on PATH that is npm. For the app it is the app's own update channel:
 * npm publishes the CLI the app happens to bundle, but the build the app will
 * actually pull is the one its feed names, and a card that quotes npm instead can
 * be right about the number and wrong about the update.
 */
export async function latestFor({ kind = '', exe = '', readLatest = latestDsh, readFeed = appUpdateInfo } = {}) {
  const npm = String((await readLatest()) || '');
  if (kind !== 'app') return { version: npm, source: 'npm', channel: '' };
  const info = await readFeed({ exe }).catch(() => null);
  if (!info?.version) return { version: npm, source: 'npm', channel: '' };
  return { version: info.version, source: 'app', channel: info.channel || '' };
}

function card(lang, status, kind, latest = {}) {
  // An app-owned CLI has no `dsh` on PATH to ask, and that is not a misplaced
  // install: the sentence a person reads here must name the app, or they go
  // looking in /doctor for a problem that does not exist.
  if (!status.installed) return t(lang, kind === 'app' ? 'ctrl.dsh.appNoVersion' : 'ctrl.dsh.noInstalled');
  const lines = [
    status.latest
      ? t(lang, 'ctrl.dsh.head', { installed: status.installed, latest: status.latest })
      : t(lang, 'ctrl.dsh.headUnknown', { installed: status.installed }),
  ];
  if (status.tested === true) lines.push(t(lang, 'ctrl.dsh.tested', { range: status.range }));
  if (status.tested === false) lines.push(t(lang, 'ctrl.dsh.untested', { range: status.range }));
  // Which copy of the CLI this is decides what an update even means: the app's
  // own CLI is not npm's, and a person who reads "update" and gets a second
  // install has been told the wrong thing in the one place that names versions.
  if (kind === 'app') {
    // With the version in hand the two facts belong in one sentence — what the
    // app carries and where npm is — because the ownership note ("updates with
    // the app") is exactly what that sentence already means. Only the blank
    // case needs the ownership note on its own, to explain why the version is
    // missing instead of leaving a hole where a number should be.
    if (status.outdated) lines.push(t(lang, 'ctrl.dsh.appBehind', { installed: status.installed, latest: status.latest }));
    else if (status.latest && status.installed) lines.push(t(lang, 'ctrl.dsh.appCurrent', { latest: status.latest }));
    else lines.push(t(lang, 'ctrl.dsh.fromApp'));
    // Where the number came from, so the person knows whether "latest" means the
    // app's own channel or npm's, and can check it themselves.
    if (latest.source === 'app' && status.latest) {
      lines.push(t(lang, 'ctrl.dsh.appSource', { channel: latest.channel || 'latest' }));
    } else if (status.latest) {
      lines.push(t(lang, 'ctrl.dsh.appSourceNpm'));
    }
  }
  // "Update available" and "could not ask" must not read the same: an unknown
  // latest is not an up-to-date install. An app-owned CLI gets no update hint at
  // all — the npm command the hint names is the one that cannot help it.
  if (status.outdated && kind !== 'app') lines.push(t(lang, 'ctrl.dsh.hint'));
  return lines.join('\n');
}

/**
 * Install the published version and report back, without holding the bot.
 *
 * `spawnSync` was the first shape of this and it froze the whole bridge for as
 * long as npm took — up to the fifteen-minute timeout — so a person pressing the
 * button in one topic stopped every other topic from being answered. The child is
 * asynchronous now and the caller returns to the poll loop immediately; the
 * result is written to the chat when it lands, by the same `reply` closure.
 */
/**
 * One npm result, whatever shape the caller's runner uses.
 *
 * The tests inject a `run` that answers like `spawnSync` (`{status, stderr}`) and
 * the real path answers with `{ok, error}`; a command that read only the second
 * would treat every injected failure as a success.
 */
function normalize(result, cmd) {
  if (!result) return { ok: false, error: 'npm produced no result', cmd };
  if (typeof result.ok === 'boolean') return { ...result, cmd };
  if (result.status === 0) return { ok: true, cmd };
  const tail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
  return { ok: false, error: tail || `exit ${result.status}`, cmd };
}

function install({ latest, run = null }) {
  const cmd = `npm i -g @deepseek-ai/dsh@${latest}`;
  if (run) return Promise.resolve(run('npm', ['i', '-g', `@deepseek-ai/dsh@${latest}`]))
    .then((result) => normalize(result, cmd))
    .catch((error) => ({ ok: false, error: error.message, cmd }));
  return new Promise((resolve) => {
    let stderr = '';
    let child;
    try {
      child = spawn('npm', ['i', '-g', `@deepseek-ai/dsh@${latest}`], {
        shell: true,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, error: error.message, cmd });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ ok: false, error: 'npm did not finish in 15 minutes', cmd });
    }, 15 * 60 * 1000);
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    // A child that cannot be started at all (no npm on PATH) emits `error` and
    // never `close`, so resolving only on `close` left the command silent.
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, cmd });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(normalize({ status: code, stderr }, cmd));
    });
  });
}

/** What version a turn would actually run: the CLI's answer, or the app's copy. */
export function installedVersion({ kind = '', exe = '', installed = installedDsh, appVersion = appDshVersion } = {}) {
  return installed() || (kind === 'app' ? appVersion(exe) : '');
}

export async function handleDshCommands(ctx, deps = {}) {
  const { effective, arg, lang, reply, log } = ctx;
  if (effective !== '/dsh') return false;
  const words = String(arg || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const readLatest = deps.latest || latestDsh;
  const readFeed = deps.feed || appUpdateInfo;
  const run = deps.run || null;
  const forget = deps.forget || forgetInstalledDsh;
  // Which CLI the bridge measured, and therefore which one an update would have
  // to touch. `dshLaunch` is the same module a turn uses to pick its binary, so
  // "what /dsh reads" and "what a turn runs" cannot drift apart.
  const launch = deps.launch || dshLaunch();
  const kind = deps.kind || launch.kind;
  const appVersion = deps.appVersion || appDshVersion;
  // The app keeps its CLI inside `app.asar`, where `dsh --version` cannot reach
  // it: without this fallback the one screen about versions would answer "unknown"
  // on the platform where "am I current" is the question being asked.
  const readInstalled = deps.installed
    || ((opts = {}) => installedVersion({
      kind,
      exe: launch.exe,
      installed: () => installedDsh(opts),
      appVersion,
    }));

  if (words[0] !== 'update') {
    if (words.length) {
      await reply(t(lang, 'ctrl.dsh.usage'));
      return true;
    }
    const latest = await latestFor({ kind, exe: launch.exe, readLatest, readFeed });
    const status = dshStatus({ installed: readInstalled(), latest: latest.version });
    // The two presses are the two words of the command, so nothing here has a
    // second path into npm: `ds:update` types `/dsh update`, `ds:confirm` types
    // the confirm. A card that only says "type /dsh update" costs the person the
    // one thing buttons are for. The app press leads to a different plan (an
    // installer, not npm), which is why the plan, not the card, says what runs.
    const buttons = status.outdated
      ? [[{ text: t(lang, kind === 'app' ? 'ctrl.dsh.appButton' : 'ctrl.dsh.button', { latest: status.latest }), data: 'ds:update' }]]
      : [];
    await reply(card(lang, status, kind, latest), buttons.length ? { keyboard: buttons } : undefined);
    return true;
  }

  // The app's CLI is not npm's copy: updating it means replacing the desktop
  // build, which is the one operation here that closes the app it updates. The
  // bridge can still do it — it has the feed, the installer URL and the hash —
  // but it says so first, because "installed successfully" is not a claim a
  // person can check while the window they were using has disappeared.
  if (kind === 'app') {
    const newest = await latestFor({ kind, exe: launch.exe, readLatest, readFeed });
    const installed = readInstalled();
    const status = dshStatus({ installed, latest: newest.version });
    if (!status.latest) {
      await reply(t(lang, 'ctrl.dsh.appNoFeed'));
      return true;
    }
    if (!status.outdated) {
      await reply(t(lang, 'ctrl.dsh.appNothing', { latest: status.latest }));
      return true;
    }
    const info = await readFeed({ exe: launch.exe }).catch(() => null);
    if (!info?.installer) {
      await reply(t(lang, 'ctrl.dsh.appNoFeed'));
      return true;
    }
    const size = info.size ? formatSize(info.size) : t(lang, 'ctrl.dsh.appSizeUnknown');
    if (!words.includes('confirm')) {
      await reply(t(lang, 'ctrl.dsh.appPlan', { installed, latest: status.latest, size }), {
        keyboard: [[{ text: t(lang, 'ctrl.dsh.confirmButton'), data: 'ds:confirm' }]],
      });
      return true;
    }
    log(`/dsh update: installing the app ${status.latest}`);
    await reply(t(lang, 'ctrl.dsh.appDownloading', { size }));
    const download = deps.download || downloadInstaller;
    const got = await download({ info, dir: (deps.downloadDir || downloadDir)() });
    if (!got.ok) {
      await reply(t(lang, got.error === 'sha512 mismatch' ? 'ctrl.dsh.appBadHash' : 'ctrl.dsh.appError', { error: got.error }));
      return true;
    }
    const open = deps.installer || launchInstaller;
    if (!open(got.path)) {
      await reply(t(lang, 'ctrl.dsh.appSaved', { version: status.latest, path: got.path }));
      return true;
    }
    await reply(t(lang, 'ctrl.dsh.appDone', { version: status.latest, path: got.path }));
    return true;
  }

  const latest = await readLatest();
  if (!latest) {
    await reply(t(lang, 'ctrl.dsh.noLatest'));
    return true;
  }
  if (!words.includes('confirm')) {
    await reply(t(lang, 'ctrl.dsh.plan', { cmd: `npm i -g @deepseek-ai/dsh@${latest}` }), {
      keyboard: [[{ text: t(lang, 'ctrl.dsh.confirmButton'), data: 'ds:confirm' }]],
    });
    return true;
  }
  log(`/dsh update: installing @deepseek-ai/dsh@${latest}`);
  await reply(t(lang, 'ctrl.dsh.running', { version: latest }));
  const result = await install({ latest, run });
  if (!result.ok) {
    await reply(t(lang, 'ctrl.dsh.error', { error: result.error }));
    return true;
  }
  forget();
  const after = readInstalled({ fresh: true });
  await reply(t(lang, 'ctrl.dsh.done', { version: after || latest }));
  return true;
}