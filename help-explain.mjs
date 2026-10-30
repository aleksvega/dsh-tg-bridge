// Which command sits in which /help group, and what to say when somebody asks
// about one. Every command has exactly one name now: the lookalike pairs
// (/task|/tasks, /model|/models, /plugin|/plugins, /agents|/agentset) were one
// letter apart and did different jobs, which is a mistake a phone keyboard makes
// for the person. The old spellings still work, and asking about one answers with
// the command that owns the job — nothing here ever advertises an alias.
import { COMMAND_ALIASES, CONTROL_COMMANDS } from './commands-registry.mjs';
import { t } from './i18n.mjs';

/** The /help group each command is listed under. */
const SECTION = {
  cd: 'Work', new: 'Work', stop: 'Work', send: 'Work', seed: 'Work', diff: 'Work',
  goal: 'Goals', task: 'Goals', tasks: 'Goals',
  status: 'Sessions', sessions: 'Sessions', rewind: 'Sessions', profile: 'Sessions',
  agents: 'Agents', model: 'Models', prices: 'Models', cost: 'Models', thoughts: 'Models', fallback: 'Models',
  effort: 'Tuning', permissions: 'Tuning', preset: 'Tuning', crew: 'Tuning', plan: 'Tuning', jobs: 'Tuning', remind: 'Tuning',
  skills: 'Extensions', plugins: 'Extensions', soul: 'Extensions',
  update: 'Versions', subscribe: 'Versions',
  load: 'Models', settings: 'Other', lang: 'Other', reasoning: 'Other', pin: 'Other', doctor: 'Other', logs: 'Other', report: 'Other',
  app: 'Other', restart: 'Other', help: 'Other', menu: 'Panels',
};

/**
 * The explanation for one command, or '' when there is no such command.
 * A command with a sentence of its own gets it; the rest get the line from
 * /help that lists them, so a reader still sees the command in context.
 */
export function explainCommand(name, lang, t) {
  const typed = String(name || '').trim().toLowerCase().replace(/^\//, '');
  if (!CONTROL_COMMANDS.includes(typed)) return '';
  // An old spelling answers as the command that owns the job. Saying "that one
  // is the same as /task" would teach the alias back, which is the confusion
  // this file exists to end.
  const clean = COMMAND_ALIASES[typed] || typed;
  const about = t(lang, `ctrl.help.about.${clean}`);
  if (about && !about.startsWith('ctrl.help.about.')) return about;
  const body = String(t(lang, 'help.body'));
  const want = SECTION[clean];
  const line = want ? (body.split('\n').find((row) => row.startsWith(`${want}:`)) || '') : '';
  const head = t(lang, 'ctrl.help.versus', { name: clean });
  return line ? `${head}\n\n${line}` : head;
}
