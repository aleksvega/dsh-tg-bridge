// `/diff` and the buttons under it: the review loop, from a phone.
//
// A turn that changes files ends with one question — "did it change what I
// asked for, and is any of it wrong". A unified diff answers that on a desktop
// and drowns a phone, so the card splits the diff into hunks and gives each hunk
// two buttons. Both act on an id that only matches the diff as it is right now.
//
// The git calls live here rather than in `diff.mjs`, which stays pure: it turns
// text into a card, and everything that touches a repository is one function
// below. One group of the `/` surface — `control.mjs` owns the dispatch.
import { execFileSync } from 'node:child_process';
import { normalizeLang, t } from '../i18n.mjs';
import { sendWithMarkup } from '../telegram.mjs';
import { diffPress, findHunk, hunkPatch, parseDiff, renderDiffCard } from '../diff.mjs';

/** How many hunks get buttons before the rest are only counted. */
const HUNK_BUTTONS = 12;

/**
 * `git -C <cwd> <args>` as `{ ok, out, err }`.
 *
 * The exit code is the answer to "did it work", and the old helper that returned
 * `''` for both success and failure made a failed revert look like a successful
 * one. One shape for every call, so no caller has to guess.
 */
function git(cwd, args, input) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ok: true, out, err: '' };
  } catch (error) {
    const err = String(error?.stderr || error?.message || '').split('\n').find((line) => line.trim()) || '';
    return { ok: false, out: String(error?.stdout || ''), err: err.trim() };
  }
}

/** True when `cwd` is inside a work tree, the only place a diff exists. */
export function isRepo(cwd) {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']).out.trim() === 'true';
}

/**
 * The working tree as data: tracked changes against HEAD, plus the names of new
 * files. Untracked files are listed and never rendered — they have no hunks, and
 * a screen of `+` lines from a fresh `node_modules` is not a review.
 */
export function readDiff(cwd) {
  const files = parseDiff(git(cwd, ['diff', '--no-color', '--no-ext-diff', 'HEAD']).out);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard'])
    .out.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { files, untracked };
}

/**
 * The card for one directory in one language, with the button list capped.
 *
 * A keyboard of forty rows is a keyboard nobody presses, so the tail is counted
 * in the text instead: nothing is hidden without saying so.
 */
export function diffCard(cwd, lang, { detail = true } = {}) {
  const { files, untracked } = readDiff(cwd);
  const card = renderDiffCard({ files, untracked, t: (key, vars) => t(lang, key, vars), detail });
  const rows = card.keyboard.filter((row) => row[0]?.data !== 'df:f');
  if (rows.length <= HUNK_BUTTONS) return card;
  const dropped = rows.length - HUNK_BUTTONS;
  return {
    ...card,
    text: `${card.text}\n\n${t(lang, 'diff.tooManyButtons', { n: dropped })}`,
    keyboard: [...rows.slice(0, HUNK_BUTTONS), ...card.keyboard.slice(rows.length)],
  };
}

export async function handleDiffCommands(ctx) {
  const { reply, log, config, state, key, lang: rawLang } = ctx;
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const effective = ctx.effective || ctx.command;
  if (effective !== '/diff') return false;

  const cwd = (state?.cwd && state.cwd[key]) || config?.cwd || '';
  if (!cwd || !isRepo(cwd)) {
    await reply(t(lang, 'diff.notRepo', { dir: cwd || t(lang, 'diff.noDir') }));
    return true;
  }
  // `/diff stat` is the summary alone: on a phone the file list is often the
  // whole answer, and it costs one message instead of six.
  const detail = !/^(stat|files|short)$/i.test(String(ctx.arg || '').trim());
  const card = diffCard(cwd, lang, { detail });
  await reply(card.text, { keyboard: card.keyboard });
  log(`diff card for ${key} in ${cwd}: ${card.keyboard.length} button(s)`);
  return true;
}

/**
 * The press handler, bound to one chat.
 *
 * `callbacks.mjs` sits at the 500-line ceiling, and this button needs seven
 * things from it: the answer, the keyboard wipe, a sender, the queue, the turn
 * pipeline, the topic and its language. Binding them here keeps the router to
 * four lines and keeps this module out of `handle-message.mjs`, which would be
 * a cycle. The returned function answers `false` for a button that is not ours.
 */
export function diffPressRouter({ chatId, threadId, key, lang, config, state, answer, clearKeyboard, log, enqueue, handleMessage }) {
  return (data) => handleDiffPress({
    data,
    cwd: (state?.cwd && state.cwd[key]) || config?.cwd || '',
    lang,
    key,
    answer,
    clearKeyboard,
    log,
    send: (body, keyboard) => sendWithMarkup(chatId, threadId, body, { keyboard }),
    explain: (prompt) => enqueue(key, () => handleMessage({
      chat: { id: chatId },
      from: { id: config.allowedUserIds[0] },
      message_id: 0,
      message_thread_id: threadId || undefined,
      is_topic_message: threadId > 0,
      text: prompt,
    })),
  });
}

export async function handleDiffPress({ data, cwd, lang, key, answer, clearKeyboard, send, explain, log }) {
  const press = diffPress(data);
  if (!press) return false;

  if (press.action === 'f') {
    const card = diffCard(cwd, lang);
    await send(card.text, card.keyboard);
    await answer(t(lang, 'diff.refreshed'));
    return true;
  }

  const found = findHunk(readDiff(cwd).files, press.id);
  if (!found) {
    // The hunk is not in the diff any more: the file was reverted, edited or
    // committed since the card was drawn. Refusing is the only safe answer —
    // acting on the line number would touch code nobody was looking at.
    await answer(t(lang, 'diff.stale'));
    return true;
  }
  const { file, hunk } = found;
  const where = hunk.newStart || hunk.oldStart;

  if (press.action === 'x') {
    await answer(t(lang, 'diff.explaining'));
    log(`diff explain ${file.path}:${where} for ${key}`);
    await explain(`${t(lang, 'diff.explainPrompt', { file: file.path, line: where })}\n\n\`\`\`diff\n${hunkPatch(file, hunk)}\`\`\``);
    return true;
  }

  // Revert exactly this hunk, and only if it still applies cleanly. `-R` turns
  // "add these lines" into "take them away"; `--recount` lets git fix a header
  // that a single hunk taken out of context often gets wrong. A hunk that no
  // longer matches fails here and changes nothing, which is the whole point of
  // addressing it by content hash rather than by line number.
  const applied = git(cwd, ['apply', '-R', '--recount', '-'], hunkPatch(file, hunk));
  if (!applied.ok) {
    await answer(t(lang, 'diff.revertFailed', { why: applied.err || t(lang, 'diff.noReason') }));
    log(`diff revert failed ${file.path}:${where}: ${applied.err}`);
    return true;
  }
  await clearKeyboard();
  log(`diff reverted ${file.path}:${where} for ${key}`);
  await answer(t(lang, 'diff.reverted', { file: file.path, line: where }));
  const card = diffCard(cwd, lang);
  await send(card.text, card.keyboard);
  return true;
}
