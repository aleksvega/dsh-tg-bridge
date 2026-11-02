// What /help says about one command.
//
// The list and the answer to "what is /rewind" used to be written in two places:
// the list was a paragraph of translated text, and this module looked for a line
// in it whose label matched an English section name. In Russian there is no
// `Models:` line, so every question about a command without an entry of its own
// answered with a heading and nothing under it. Now both come from the same
// table: the section says which commands it holds, and the answer quotes it.
import { COMMAND_ALIASES, CONTROL_COMMANDS } from './commands-registry.mjs';
import { commandsOf, DOC_URL, sectionFor } from './help-sections.mjs';
import { t } from '../core/i18n.mjs';

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
  const section = sectionFor(clean);
  if (!section) return t(lang, 'ctrl.help.versus', { name: clean });
  const head = t(lang, 'ctrl.help.versus', { name: clean });
  const line = `${t(lang, `help.section.${section}`)}: ${commandsOf(section).join(' · ')}`;
  // The page, so "where do I read about the rest" has an answer that does not
  // depend on remembering `/help <command>`.
  return `${head}\n\n${line}\n\n${DOC_URL}`;
}