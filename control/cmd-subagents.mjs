// `/subagents` — the desktop app's subagent panel, as far as a headless turn
// can fill it.
//
// The card itself lives in `chat/subagents-card.mjs`; this file is the command:
// where the runs come from, and the one word that forgets them.
import { t } from '../core/i18n.mjs';
import { saveState } from '../core/state.mjs';
import { subagentsCard } from '../chat/subagents-card.mjs';
import { forgetRuns, runsOf } from '../work/subagents.mjs';

export async function handleSubagentCommands(ctx) {
  const { effective, arg, reply, lang, state, key } = ctx;
  if (effective !== '/subagents') return false;
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));

  if (String(arg || '').trim().toLowerCase() === 'clear') {
    // The history is the topic's own memory, so forgetting it is a word on the
    // same command rather than a second name to remember.
    const dropped = forgetRuns(state, key);
    if (dropped) saveState();
    say(t(lang, 'ctrl.sa.cleared', { n: dropped }));
    return true;
  }

  // A word the command does not know is answered with what it does, not with a
  // card that ignores the question.
  if (String(arg || '').trim()) {
    say(t(lang, 'ctrl.sa.usage'));
    return true;
  }

  say(subagentsCard(lang, runsOf(state, key)).text);
  return true;
}
