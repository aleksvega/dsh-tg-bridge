// The status message of a running turn: one editable card instead of a stream.
//
// Extracted from the poller because it is the part a person actually stares at,
// and because it was the part nobody could review: 240 lines inside a 2500-line
// file, rewritten between two other moves. Its inputs are the language, the
// topic and the task; everything Telegram-facing comes from `telegram.mjs`, and
// the layout from `panel.mjs` (a pure renderer, still untouched).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, log, state } from '../core/state.mjs';
import { THOUGHT_DIR } from '../core/paths.mjs';
import { sessionKey } from '../core/keys.mjs';
import { tg } from '../chat/telegram.mjs';
import { topicName } from '../chat/topics.mjs';
import { t } from '../core/i18n.mjs';
import { addStep, progressPanel, stepLine } from '../chat/panel.mjs';
import { reasoningMode, thoughtRows } from '../chat/notes.mjs';
import { cardPin } from '../profile/settings-card.mjs';
import { continueKeyboard, errorKeyboard } from '../chat/keyboards.mjs';
import { contextFill, contextRow, contextUsed } from './context-meter.mjs';
import { modelOf, windowOf } from '../control/models.mjs';
import { usageCost, usd, priceOf } from '../model/cost.mjs';
import { loadPrices } from '../model/price-cache.mjs';

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
  // `totalTokens` is the provider's own sum of the prompt it just sent, which is
  // exactly the context size; the two parts are kept for the cache line.
  const usage = { inputTokens: 0, cacheReadTokens: 0, totalTokens: 0, outputTokens: 0, outputTotal: 0 };
  // The window this topic's model actually runs with, read once: it cannot
  // change mid-turn, and a file read on every edit would be silly. Zero means
  // the profile declares no window, and then the meter says nothing at all.
  // Read here rather than through `profileOf` from `turn.mjs`: this module
  // renders, and the turn module is what spawns processes — a renderer that
  // imports the runner is the cycle this codebase already paid for once.
  // Who answers this topic, and how much room it has. Both are read once: a
  // profile cannot change mid-turn, and the same lookup drives the context meter
  // and the money line.
  const route = modelOf((state.profiles && state.profiles[panelKey]) || config.profile || 'headless');
  const contextLimit = (() => {
    try {
      return windowOf((state.profiles && state.profiles[panelKey]) || config.profile || 'headless', route.model) || 0;
    } catch {
      return 0;
    }
  })();
  // The price of this turn's tokens, or '' when the cache cannot say. The read is
  // lazy in the sense that matters: no cache means no line, never a guess.
  const turnCost = (turnUsage, turnLang) => {
    const { models } = loadPrices();
    const price = priceOf(models, route.model, route.provider);
    if (!price) return '';
    const cost = usageCost(turnUsage, price);
    if (!cost || !(cost.total > 0)) return '';
    return t(turnLang, 'status.costLine', { sum: usd(cost.total) });
  };
  let messageId = 0;
  let lastEdit = 0;
  let dirty = false;
  let timer = null;

  // Short "💭" notes the agent appends with `say.mjs --thought`. The progress
  // message shows the last two, so the person sees the decision trail without
  // a second stream of chat messages. The path is unique per turn (see
  // startTurn) so two turns never share one file.
  //
  // Two writers exist and they do not agree on the path. The turn's own file
  // (`DSH_TG_THOUGHT`) is only reachable when the tool shell inherits the
  // bridge's environment, and tool shells usually do not — so `say.mjs` falls
  // back to the stable per-topic file. Reading only the first path silently
  // dropped every note: the 💭 block stayed empty for a whole session while the
  // topic file on disk kept growing. Read both, keep this turn's lines only.
  const notes = thoughtFile || join(THOUGHT_DIR, `${chatId}_${threadId || 0}.jsonl`);
  const topicNotes = join(THOUGHT_DIR, `${chatId}_${threadId || 0}.jsonl`);
  let thoughts = [];
  // In `chat` mode every note also leaves the card as its own message: a turn
  // that runs for twenty minutes is read as it happens, not scrolled back to.
  // The set holds what already went out, so a rewrite of the card never repeats
  // a step, and a note that arrives while the person is reading is not lost.
  const forwarded = new Set();
  // Switching to chat mid-turn must not dump the steps already shown in the card
  // into the chat as a burst: the mode takes effect from the next step written
  // after the switch. A turn that starts in chat mode forwards from its first
  // line, so `chatFrom` is the turn's own start in that case.
  let chatFrom = reasoningMode(state, config, panelKey) === 'chat' ? started : Infinity;
  let wasChat = Number.isFinite(chatFrom);
  try {
    mkdirSync(THOUGHT_DIR, { recursive: true });
    // Start this turn's file empty — but never truncate the stable per-topic
    // file, which is shared history and the only record when a turn wrote
    // through the fallback path.
    if (thoughtFile) writeFileSync(notes, '');
  } catch {}
  const thoughtTimer = setInterval(() => {
    const mode = reasoningMode(state, config, panelKey);
    if (mode === 'chat' && !wasChat) chatFrom = Date.now();
    wasChat = mode === 'chat';
    if (mode === 'off') {
      if (thoughts.length) {
        thoughts = [];
        schedule();
      }
      return;
    }
    const rows = thoughtRows([notes, topicNotes], started);
    if (mode === 'chat') {
      for (const row of rows) {
        if (row.at < chatFrom) continue;
        const id = `${row.at}:${row.text}`;
        if (forwarded.has(id)) continue;
        forwarded.add(id);
        // One message per decision, and a failed send must not kill the turn:
        // the note is still in the card, which is where it always lived.
        tg('sendMessage', {
          chat_id: chatId,
          text: `💭 ${row.text}`,
          disable_web_page_preview: true,
          ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        }).catch((error) => log(`note forward failed: ${String(error.message).slice(0, 100)}`));
      }
    }
    const merged = rows.slice(-2).map((row) => row.text);
    if (merged.join('\n') !== thoughts.join('\n')) {
      thoughts = merged;
      schedule();
    }
  }, 3000);
  thoughtTimer.unref?.();

  const panel = (final = false) => {
    // The cache line belongs to the outcome, not to every intermediate edit.
    // How full the context is. A live card shows it only once it matters —
    // a percentage that is always there is read once and ignored forever — and
    // the final card always shows it, which is where the number is learned
    // without a command. Empty when the window or the usage is unknown.
    const fill = contextFill({ used: contextUsed(usage), limit: contextLimit });
    const context = fill && (final || fill.level !== 'ok')
      ? contextRow({ used: fill.used, limit: fill.limit }, lang)
      : '';
    // What this turn cost, when the price cache already knows the model. It is
    // read from disk and never fetched: an answer must not wait on a catalog.
    // No cache means no line, which is honest — the tokens are in `/cost`.
    const money = final ? turnCost(usage, lang) : '';
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
      // When the name is not there yet — the first turn after a restart always
      // races the cache — say "id 337382" and not "тема {n}", which reads like a
      // template that forgot to render.
      topic: threadId
        ? (topicName(chatId, threadId)
          ? t(lang, 'bridge.progress.topic', { n: threadId, name: topicName(chatId, threadId) })
          : t(lang, 'bridge.progress.topicId', { n: threadId }))
        : '',
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
      context,
      money,
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

  // Pinned on request. Telegram keeps one pinned message per chat and topic, so
  // pinning this card is also what replaces the previous turn's — the slot always
  // holds the turn that is running now, or the numbers of the one that just
  // finished. A pin that lands with a notification reads as an interruption, so
  // it goes silently; a chat where the bot may not pin is not an error either —
  // the card works the same unpinned, and the reason belongs in the log.
  if (messageId && cardPin(state, config, panelKey) === 'on') {
    tg('pinChatMessage', {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: true,
    }).catch((error) => log(`pin failed: ${String(error.message).slice(0, 120)}`));
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
    /** The reasoning this turn produced, as one string.
     *
     * The answer is checked against this before it is sent: a turn that ends
     * without one reports the last assistant text it has, which is the
     * reasoning, and that must not reach the chat as a reply. */
    reasoning() {
      return thinkingParts.join('\n\n');
    },
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
        if (Number.isFinite(event.usage.totalTokens)) usage.totalTokens = event.usage.totalTokens;
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
      if (result?.stopped) {
        // The person pressed Стоп. The card says so in their words, not with a
        // ⚠️ and not with a retry button: nothing failed, and the session is
        // exactly where they left it, so the next message just continues.
        await edit(`⏹ ${t(lang, 'msg.turnStopped')}`, continueKeyboard(sessionKey(chatId, threadId), lang));
        return true;
      }
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

