// A button stands for a command, and must reach `handleControl` exactly the
// way a typed one does.
import { langFor } from '../chat/commands.mjs';
import { handleControl } from '../chat/control.mjs';
import { t } from './i18n.mjs';
import { maxParallel, queues } from '../turn/queue.mjs';
import { config, log, saveConfig, saveState, state } from './state.mjs';
import { send, sendEphemeral, sendFile, sendWithMarkup, tg } from '../chat/telegram.mjs';
import { ensureTopicSeed } from '../chat/topics.mjs';
import { activeTurns, baseProfileOf, turnStartedAt } from '../turn/turn.mjs';

export async function runCommandFromButton(typed, { chatId, threadId, key }) {
  const lang = langFor(chatId, threadId);
  const [head, ...rest] = typed.trim().split(/\s+/);
  const arg = rest.join(' ');
  const handled = await handleControl({
    command: head,
    arg,
    text: typed,
    lang,
    chatId,
    threadId,
    key,
    state,
    config,
    activeTurns,
    saveState,
    saveConfig,
    log,
    send,
    jobs: () => ({
      active: [...activeTurns.keys()].map((topic) => ({ key: topic, startedAt: turnStartedAt.get(topic) || 0 })),
      queued: [...queues.keys()].filter((topic) => !activeTurns.has(topic)).length,
      max: maxParallel(),
    }),
    api: tg,
    sendFile: (p, caption = '') => sendFile(chatId, threadId, p, caption),
    // A report meant to be read once (/thoughts) can ask for a message that
    // removes itself. Without this the chat is told it will disappear while the
    // message is a normal one — a promise nothing was keeping.
    ephemeral: (out) => sendEphemeral(chatId, out, threadId),
    seedTopic: ensureTopicSeed,
    profile: baseProfileOf(key),
    reply: (out, extra = {}) => sendWithMarkup(chatId, threadId, out, extra),
    stopTurn: (k) => {
      const child = activeTurns.get(k);
      if (!child) return false;
      try {
        child.kill();
        activeTurns.delete(k);
        return true;
      } catch {
        return false;
      }
    },
  });
  if (!handled) await send(chatId, t(lang, 'bridge.cb.unknown'), threadId);
}
