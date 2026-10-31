// `/dsh` — which harness is installed, which one npm has, and whether this
// bridge was ever tested against it.
//
// The three facts come from three places (`dsh --version`, npm's registry, and
// this package's own engines range), and the point of the card is that the third
// one is a claim someone can check. A version outside the range is a warning,
// never a block: DSH moves faster than this bridge is re-tested, and refusing to
// run would be a lie about how much is known.
import { spawnSync } from 'node:child_process';

import { t } from '../core/i18n.mjs';
import { dshStatus, forgetInstalledDsh, installedDsh, latestDsh } from '../core/dsh-version.mjs';

function card(lang, status) {
  if (!status.installed) return t(lang, 'ctrl.dsh.noInstalled');
  const lines = [
    status.latest
      ? t(lang, 'ctrl.dsh.head', { installed: status.installed, latest: status.latest })
      : t(lang, 'ctrl.dsh.headUnknown', { installed: status.installed }),
  ];
  if (status.tested === true) lines.push(t(lang, 'ctrl.dsh.tested', { range: status.range }));
  if (status.tested === false) lines.push(t(lang, 'ctrl.dsh.untested', { range: status.range }));
  // "Update available" and "could not ask" must not read the same: an unknown
  // latest is not an up-to-date install.
  if (status.outdated) lines.push(t(lang, 'ctrl.dsh.hint'));
  return lines.join('\n');
}

/**
 * Install the published version and say what happened.
 *
 * Deliberately not automatic: it replaces the harness every profile boots on,
 * and the bridge keeps running on the old binary until someone restarts it, so
 * the answer names the restart instead of implying the new version is live.
 */
function install({ latest, run = spawnSync }) {
  const cmd = `npm i -g @deepseek-ai/dsh@${latest}`;
  try {
    const r = run('npm', ['i', '-g', `@deepseek-ai/dsh@${latest}`], {
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      shell: true,
      windowsHide: true,
    });
    if (r?.status !== 0) {
      const tail = String(r?.stderr || r?.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
      return { ok: false, error: tail || `exit ${r?.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function handleDshCommands(ctx, deps = {}) {
  const { effective, arg, lang, reply, log } = ctx;
  if (effective !== '/dsh') return false;
  const words = String(arg || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const readInstalled = deps.installed || installedDsh;
  const readLatest = deps.latest || latestDsh;
  const run = deps.run || spawnSync;
  const forget = deps.forget || forgetInstalledDsh;

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
    const buttons = status.outdated ? [[{ text: t(lang, 'ctrl.dsh.button', { latest: status.latest }), data: 'ds:update' }]] : [];
    await reply(card(lang, status), buttons.length ? { keyboard: buttons } : undefined);
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
  const result = install({ latest, run });
  if (!result.ok) {
    await reply(t(lang, 'ctrl.dsh.error', { error: result.error }));
    return true;
  }
  forget();
  const after = readInstalled({ fresh: true });
  await reply(t(lang, 'ctrl.dsh.done', { version: after || latest }));
  return true;
}