// Which commands need a sentence each, and which only need their line from
// /help. The pairs are the whole reason this exists: /task and /tasks, /model
// and /models, /plugin and /plugins are one letter apart and do different jobs,
// so a lookup must say which is which before it says anything else.
import { CONTROL_COMMANDS } from './control.mjs';
import { t } from './i18n.mjs';

/** The /help group each command is listed under. */
const SECTION = {
  cd: 'Work', new: 'Work', stop: 'Work', send: 'Work', seed: 'Work',
  goal: 'Goals', task: 'Goals', tasks: 'Goals',
  status: 'Sessions', sessions: 'Sessions', resume: 'Sessions', rewind: 'Sessions', profile: 'Sessions',
  agents: 'Agents', model: 'Models', models: 'Models', prices: 'Models', thoughts: 'Models',
  effort: 'Tuning', permissions: 'Tuning', preset: 'Tuning', agentset: 'Tuning', plan: 'Tuning', jobs: 'Tuning', remind: 'Tuning',
  skills: 'Extensions', plugins: 'Extensions', plugin: 'Extensions', soul: 'Extensions',
  version: 'Versions', update: 'Versions', subscribe: 'Versions',
  settings: 'Other', lang: 'Other', reasoning: 'Other', doctor: 'Other', logs: 'Other',
  app: 'Other', restart: 'Other', help: 'Other', menu: 'Panels',
};

/**
 * The explanation for one command, or '' when there is no such command.
 * A command with a sentence of its own gets it; the rest get the line from
 * /help that lists them, so a reader still sees the command in context.
 */
export function explainCommand(name, lang, t) {
  const clean = String(name || '').trim().toLowerCase().replace(/^\//, '');
  if (!CONTROL_COMMANDS.includes(clean)) return '';
  const about = t(lang, `ctrl.help.about.${clean}`);
  if (about && !about.startsWith('ctrl.help.about.')) return about;
  const body = String(t(lang, 'help.body'));
  const want = SECTION[clean];
  const line = want ? (body.split('\n').find((row) => row.startsWith(`${want}:`)) || '') : '';
  const head = t(lang, 'ctrl.help.versus', { name: clean });
  return line ? `${head}\n\n${line}` : head;
}
