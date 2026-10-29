// The two places the load guard touches the turn: before it starts, and the
// button that overrides it. Kept out of `handle-message.mjs` and `callbacks.mjs`
// because both files are at their size ceiling, and out of `machine.mjs`
// because that module knows the OS and nothing about Telegram.
import { breaches, driveOf, hold, sampleMachine, takeHeld } from './machine.mjs';

/**
 * Hold a prompt back when the machine is over a limit.
 *
 * Returns `true` when the message was held and a notice was sent, so the caller
 * stops before starting a process. Returns `false` in every other case: a guard
 * that is off, a machine that is fine, or a reading that failed — the turn then
 * runs exactly as it would have without this file.
 */
export async function holdIfLoaded({ t, lang, key, where, cwd, chatId, threadId, msg, album, sendWithMarkup, log, guard, sample }) {
  if (!guard?.enabled) return false;
  let reading;
  try {
    // `sample` is injectable so the rule can be tested without a busy machine:
    // a test that has to make a computer slow is a test nobody runs.
    reading = sample ? await sample({ drive: driveOf(cwd) }) : await sampleMachine({ drive: driveOf(cwd) });
  } catch (error) {
    // A load reading that throws is not a reason to refuse work: the guard is a
    // courtesy, and a broken courtesy must not become a blocker.
    log(`load sample failed for ${where}: ${error.message}`);
    return false;
  }
  const over = breaches(reading, guard);
  if (over.length === 0) return false;
  const id = String(Date.now()).slice(-6);
  hold(id, { msg, album, chatId, threadId });
  log(`turn held for ${where}: ${over.map((one) => `${one.key} ${one.value} vs ${one.limit}`).join(', ')}`);
  const what = over
    .map((one) => t(lang, `ctrl.load.what.${one.key}`, { value: one.value, limit: one.limit }))
    .join('; ');
  await sendWithMarkup(chatId, threadId, t(lang, 'msg.loadHeld', { what }), {
    reply_markup: {
      inline_keyboard: [[
        { text: t(lang, 'ctrl.load.runAnyway'), callback_data: `ld:y:${id}` },
        { text: t(lang, 'ctrl.load.refresh'), callback_data: 'ld:r' },
      ]],
    },
  });
  return true;
}

/**
 * A press on the held notice or on the load card.
 *
 * `run` replays the held message through the normal handler, so the guard is
 * checked again (the machine may still be busy) and the topic's own session,
 * language and directory apply. The prompt is not lost either way: only the
 * button press is consumed.
 */
export async function handleLoadPress({ data, key, t, lang, answer, clearKeyboard, redeliver, runCommandFromButton, chatId, threadId, log }) {
  const [, verb = '', id = ''] = String(data).split(':');
  await answer(verb === 'y' ? t(lang, 'ctrl.load.running') : t(lang, 'ctrl.load.refreshing'));
  await clearKeyboard();
  if (verb === 'y') {
    const payload = takeHeld(id);
    if (!payload) {
      await answer(t(lang, 'ctrl.load.heldGone'));
      return;
    }
    log(`held turn released by hand for ${key}`);
    await redeliver(key, payload.msg);
    return;
  }
  await runCommandFromButton('/load', { chatId, threadId, key, lang });
}