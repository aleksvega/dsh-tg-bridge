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
import { dshStatus, forgetInstalledDsh, installedDsh, latestDsh } from '../core/dsh-version.mjs';

function card(lang, status, kind) {
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
  if (kind === 'app') lines.push(t(lang, 'ctrl.dsh.fromApp'));
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

export async function handleDshCommands(ctx, deps = {}) {
  const { effective, arg, lang, reply, log } = ctx;
  if (effective !== '/dsh') return false;
  const words = String(arg || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const readInstalled = deps.installed || installedDsh;
  const readLatest = deps.latest || latestDsh;
  const run = deps.run || null;
  const forget = deps.forget || forgetInstalledDsh;
  // Which CLI the bridge measured, and therefore which one an update would have
  // to touch. `dshLaunch` is the same module a turn uses to pick its binary, so
  // "what /dsh reads" and "what a turn runs" cannot drift apart.
  const kind = deps.kind || dshLaunch().kind;

  if (words[0] !== 'update') {
    if (words.length) {
      await reply(t(lang, 'ctrl.dsh.usage'));
      return true;
    }
    const latest = await readLatest();
    const status = dshStatus({ installed: readInstalled(), latest });
    // The two presses are the two words of the command, so nothing here has a
    // second path into npm: `ds:update` types `/dsh update`, `ds:confirm` types
    // the confirm. A card that only says "type /dsh update" costs the person the
    // one thing buttons are for.
    const buttons = status.outdated && kind !== 'app'
      ? [[{ text: t(lang, 'ctrl.dsh.button', { latest: status.latest }), data: 'ds:update' }]]
      : [];
    await reply(card(lang, status, kind), buttons.length ? { keyboard: buttons } : undefined);
    return true;
  }

  // The app's CLI is not npm's copy, so this branch is not "an update that needs
  // a restart" — it is an operation that would install something a turn never
  // launches. Doing it and reporting success is the one outcome nobody can see
  // through, so it is refused with the reason instead.
  if (kind === 'app') {
    await reply(t(lang, 'ctrl.dsh.appPlan'));
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