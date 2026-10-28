// The goal card, the task list and the reasoning switch: the three small views `/goal` and `/tasks` draw.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { t } from '../i18n.mjs';
import { progressOf } from '../goals.mjs';
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from '../commands-registry.mjs';

import { read } from './models.mjs';
/**
 * The task list as a keyboard: one button per task, labelled with its number and
 * state. A tap marks the task done and a second tap undoes it, so managing the
 * plan costs no typing. Long lists are cut at Telegram's 100-button limit.
 */
export function taskKeyboard(goal) {
  if (!goal || goal.done) return [];
  const rows = [];
  // `i + 2 < length` drew no rows at all for a goal with one or two tasks —
  // exactly the goals a person has when they want to tick the first one.
  for (let i = 0; i < Math.min(goal.tasks.length, 90); i += 3) {
    rows.push(goal.tasks.slice(i, i + 3).map((task, k) => {
      const n = i + k + 1;
      return { text: `${task.done ? '✅' : '⬜'} ${n}`, data: `t:${n}` };
    }));
  }
  return rows;
}

/** Goal + task list as one message; empty list is shown, not hidden. */
export function goalView(goal, lang) {
  const { done, total } = progressOf(goal);
  const lines = [t(lang, 'goal.set', { text: goal.text })];
  if (goal.tasks.length === 0) {
    lines.push(t(lang, 'task.empty'));
  } else {
    goal.tasks.forEach((task, i) => lines.push(`${task.done ? '✅' : '⬜'} ${i + 1}. ${task.text}`));
    lines.push(t(lang, 'goal.progress', { done, total }));
  }
  if (goal.done) lines.push(t(lang, 'goal.closed'));
  return lines.join('\n');
}

/**
 * The checklist on its own, without the goal's wording.
 *
 * `/goal` and `/task` used to print the same card, so typing either one told a
 * person nothing about which command owns what. `/goal` is the plan (objective,
 * checklist, progress); `/task` is the list you tick — the thing you read five
 * times a day while the objective stays the same.
 */
export function taskView(goal, lang) {
  const { done, total } = progressOf(goal);
  if (goal.tasks.length === 0) return t(lang, 'task.empty');
  const lines = [t(lang, 'task.listTitle', { done, total })];
  goal.tasks.forEach((task, i) => lines.push(`${task.done ? '✅' : '⬜'} ${i + 1}. ${task.text}`));
  return lines.join('\n');
}


export { CONTROL_COMMANDS, COMMAND_ALIASES, DOCUMENTED_COMMANDS };

/**
 * Working notes ("💭" lines in the progress message) are on unless the topic or
 * the config says otherwise. Per-topic wins over the install default, so one
 * topic can keep the trail while another stays terse.
 */
export function reasoningOf(state, config, key) {
  const perTopic = state?.reasoning?.[key];
  if (typeof perTopic === 'boolean') return perTopic;
  return config?.reasoning !== false;
}

/**
 * The chat view of `bridge.log`. Delivery chatter ("sent chat=…") answers
 * nothing when the question is "what did the agent do", so the default view
 * hides it — it stays in the file for delivery debugging. `errors` keeps the
 * bridge's own faults and drops tool results, which are part of the work.
 */
export function filterLogLines(lines, filter, count) {
  const isChatter = (line) =>
    /\bsent chat=/.test(line)
    || /\bin \d+ /.test(line)
    || /bridge started|bot @|replaying \d+ pending|topic \d+ (?:seeded|logged)/.test(line);
  const isToolLine = (line) => line.includes('tool[') || /\]\s+(?:pwsh|bash|shell)\b/.test(line);

  let pool;
  if (filter === 'errors') {
    pool = lines.filter((line) => !isToolLine(line)
      && /turn failed|FATAL|unhandled|poll error|Conflict|quota|AUTH|exiting code=[1-9]|cannot |failed to/i.test(line));
  } else if (filter) {
    const needle = filter.toLowerCase();
    pool = lines.filter((line) => line.toLowerCase().includes(needle));
  } else {
    pool = lines.filter((line) => !isChatter(line));
  }
  return { pool, tail: pool.slice(-count) };
}
