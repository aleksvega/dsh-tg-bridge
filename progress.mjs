// The status message of a running turn: one editable card instead of a stream.
//
// Extracted from the poller because it is the part a person actually stares at,
// and because it was the part nobody could review: 240 lines inside a 2500-line
// file, rewritten between two other moves. Its inputs are the language, the
// topic and the task; everything Telegram-facing comes from `telegram.mjs`, and
// the layout from `panel.mjs` (a pure renderer, still untouched).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, log, state } from './state.mjs';
import { THOUGHT_DIR } from './paths.mjs';
import { sessionKey } from './keys.mjs';
import { tg } from './telegram.mjs';
import { topicName } from './topics.mjs';
import { t } from './i18n.mjs';
import { addStep, progressPanel, stepLine } from './panel.mjs';
import { continueKeyboard, errorKeyboard } from './keyboards.mjs';

/**
 * Average generation speed of a turn, in tokens per second, or 0 when unknown.
 *
 * Output tokens over wall time, not over "time spent generating": the bridge
 * sees one stream and cannot separate thinking from tool calls, and the honest
 * question the number answers is "is this turn moving", not "how fast is the
 * provider". A turn younger than a couple of seconds says nothing — one token
 * in one second is not a measurement.
 */
export function speedOf(outputTokens, ms) {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return 0;
  if (!Number.isFinite(ms) || ms < 3000) return 0;
  return Math.round(outputTokens / (ms / 1000));
}

/**
 * One editable status message per turn.
 *
 * Hermes shows the working steps; without them a long turn is indistinguishable
 * from a freeze. The message is created once, then rewritten (at most every few
 * seconds — Telegram rate-limits edits) with the latest step and a counter, and
 * finally turned into a short summary. Errors are edited into the same message
 * so the person always sees one continuous trace instead of scattered notes.
 *
 * Reasoning is folded into the same message as a collapsed block, so a turn that
 * thinks for ten minutes still leaves one line in the chat — and the whole trail
 * one tap away.
 */
export async function startProgress(chatId, threadId, lang = config.lang || 'en', task = '', chip = '', thoughtFile = '') {
  const started = Date.now();
  const panelKey = sessionKey(chatId, threadId);
  const steps = [];
  const thinkingParts = [];
  /** Last reported token usage for this turn, for the cache line. */
  const usage = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, outputTotal: 0 };
  let messageId = 0;
  let lastEdit = 0;
  let dirty = false;
  let timer = null;

  // Short "💭" notes the agent appends with `say.mjs --thought`. The progress
  // message shows the last two, so the person sees the decision trail without
  // a second stream of chat messages. The path is unique per turn (see
  // startTurn) so two turns never share one file.
  const notes = thoughtFile || join(THOUGHT_DIR, `${chatId}_${threadId || 0}.jsonl`);
  let thoughts = [];
  try {
    mkdirSync(THOUGHT_DIR, { recursive: true });
    writeFileSync(notes, '');
  } catch {}
  const thoughtTimer = setInterval(() => {
    let next = [];
    try {
      next = readFileSync(notes, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-2)
        .map((line) => {
          try { return String(JSON.parse(line).text || '').slice(0, 140); } catch { return ''; }
        })
        .filter(Boolean);
    } catch {}
    if (next.join('\n') !== thoughts.join('\n')) {
      thoughts = next;
      schedule();
    }
  }, 3000);
  thoughtTimer.unref?.();

  const panel = (final = false) => {
    // The cache line belongs to the outcome, not to every intermediate edit.
    const cache = final && usage.cacheReadTokens
      ? t(lang, 'status.cacheLine', {
        pct: Math.round((usage.cacheReadTokens / Math.max(1, usage.cacheReadTokens + (usage.inputTokens ?? 0))) * 100),
        k: Math.round(usage.cacheReadTokens / 1000),
      })
      : '';
    return progressPanel({
      lang,
      // Two topics run at once in a group, so a card that does not name its topic
      // is unattributable the moment it scrolls: the same 💭 line in the wrong
      // place looks like a cross-topic bug, and half the time it is one. The
      // name comes from Telegram, cached: one API call per topic per process.
      topic: threadId ? t(lang, 'bridge.progress.topic', { n: threadId, name: topicName(chatId, threadId) || t(lang, 'bridge.progress.topicNoName') }) : '',
      seconds: Math.round((Date.now() - started) / 1000),
      // How fast this turn is actually generating, in tokens per second. The
      // number is the turn's average — output tokens over wall time — because
      // that is what "долго" means to the reader: a slow provider and a turn
      // that spends its minutes in tools look identical without it.
      speed: speedOf(usage.outputTotal, Date.now() - started),
      final,
      steps,
      thoughts,
      thinking: thinkingParts.join('\n\n'),
      // `/thoughts off` keeps the block out of the chat and leaves the counter;
      // the log itself is a file the command sends on demand.
      reasoning: state.thinkBlock?.[panelKey] === 'counter' ? 'counter' : 'block',
      task,
      chip,
      cache,
    });
  };

  /** Send or edit the panel; `plainText` and a rejected parse fall back to text. */
  const post = async (method, payload, view, keyboard = undefined) => {
    const markup = config.plainText !== true;
    const body = markup
      ? { ...payload, text: view.html, parse_mode: 'HTML' }
      : { ...payload, text: view.plain };
    if (keyboard !== undefined) body.reply_markup = keyboard ?? { inline_keyboard: [] };
    if (!markup) return tg(method, body);
    try {
      return await tg(method, body);
    } catch (error) {
      log(`${method} html failed (${String(error.message).slice(0, 100)}); retrying as plain text`);
      const plain = { ...payload, text: view.plain };
      if (keyboard !== undefined) plain.reply_markup = keyboard ?? { inline_keyboard: [] };
      return tg(method, plain);
    }
  };

  try {
    const res = await post('sendMessage', {
      chat_id: chatId,
      disable_web_page_preview: true,
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }, panel());
    messageId = res.message_id;
  } catch (error) {
    log(`progress message failed: ${error.message}`);
  }

  let lastView = '';
  const edit = async (text, keyboard = undefined, view = null) => {
    if (!messageId) return;
    // Re-sending identical text counts as an edit on the phone (the block
    // collapses and the list re-lays-out), so a no-op must not reach Telegram.
    if (view && keyboard === undefined && view.html === lastView) {
      dirty = false;
      return;
    }
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      disable_web_page_preview: true,
    };
    try {
      if (view) await post('editMessageText', payload, view, keyboard);
      else {
        // Plain text (errors, notes): whatever the caller passes is literal, so
        // it must not be run through the HTML parser.
        const body = { ...payload, text };
        if (keyboard !== undefined) body.reply_markup = keyboard ?? { inline_keyboard: [] };
        await tg('editMessageText', body);
      }
      lastView = view ? view.html : text;
      lastEdit = Date.now();
    } catch (error) {
      // "message is not modified" and rate limits are expected: ignore quietly.
      dirty = false;
    }
  };

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      await edit('', undefined, panel());
    }, 5000);
    timer.unref?.();
  }

  return {
    /** Keep the clock moving during long model thinking: the elapsed time is
     *  proof of life, and a frozen counter is what reads as a hang. */
    heartbeat() {
      dirty = true;
      schedule();
    },
    handle(event) {
      if (event.type === 'tool_call') {
        addStep(steps, stepLine(event));
        schedule();
        return;
      }
      // The CLI emits one `thinking` event per committed assistant step, so the
      // panel grows a paragraph at a time — visible while the turn runs, and
      // still there, collapsed, when it ends.
      if (event.type === 'thinking' && event.text) {
        thinkingParts.push(String(event.text));
        // A turn can think for a long time; only the tail of the stream is ever
        // shown, so the head is dropped before it becomes a memory leak.
        if (thinkingParts.join('\n\n').length > 24000) {
          const kept = thinkingParts.join('\n\n').slice(-24000);
          thinkingParts.length = 0;
          thinkingParts.push(kept);
        }
        schedule();
        return;
      }
      // Usage rides on the status events; keep the latest numbers so the final
      // line can show the cache hit rate of this very turn, and so the head can
      // show how fast it is going — "долго" is usually either a slow provider or
      // a turn that spends its time in tools, and the panel could not tell them
      // apart.
      if (event.type === 'status' && event.usage) {
        if (Number.isFinite(event.usage.inputTokens)) usage.inputTokens = event.usage.inputTokens;
        if (Number.isFinite(event.usage.cacheReadTokens)) usage.cacheReadTokens = event.usage.cacheReadTokens;
        // `outputTokens` is per step, not cumulative: a turn of twenty steps
        // reports twenty small numbers, and dividing the last one by the whole
        // turn would claim 0.6 tok/s for a turn that ran at eighty. Sum the
        // changes, and keep the last value so a repeated event adds nothing.
        if (Number.isFinite(event.usage.outputTokens) && event.usage.outputTokens > 0) {
          if (event.usage.outputTokens !== usage.outputTokens) usage.outputTotal += event.usage.outputTokens;
          usage.outputTokens = event.usage.outputTokens;
        }
        schedule();
        return;
      }
      if (event.type === 'status' && event.phase === 'step_start') {
        schedule();
        return;
      }
      if (event.type === 'text' && event.text) {
        const first = String(event.text).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (first) {
          steps.push(t(lang, 'bridge.progress.text', { text: first }));
          schedule();
        }
      }
    },
    async finish(result) {
      clearTimeout(timer);
      clearInterval(thoughtTimer);
      if (result?.error) {
        // A failed turn leaves the status message as the error report and swaps
        // «Стоп» for «Повторить»: the person's next move is a retry, not a stop.
        const failedFor = Math.round((Date.now() - started) / 1000);
        const unit = lang === 'en' ? 's' : lang === 'zh' ? '秒' : 'с';
        // A turn stopped by the clock is not a failure to redo: the session and
        // everything it produced are still there, so the useful button is
        // «Продолжить», which asks the agent to pick up where it stopped.
        const timedOut = result.reason === 'timeout';
        const text = timedOut
          ? `⏱ ${t(lang, 'msg.turnHardCap', { minutes: result.minutes ?? '?' })}`
          : `⚠️ ${t(lang, 'status.failed')} · ${failedFor} ${unit}\n${String(result.error).slice(0, 1200)}`;
        await edit(text, timedOut ? continueKeyboard(sessionKey(chatId, threadId), lang) : errorKeyboard(sessionKey(chatId, threadId), lang));
        return true;
      }
      await edit('', null, panel(true));
      return false;
    },
  };
}

