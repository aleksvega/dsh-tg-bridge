// What /help says about one command.
//
// The list and the answer to "what is /rewind" used to be written in two places:
// the list was a paragraph of translated text, and this module looked for a line
// in it whose label matched an English section name. In Russian there is no
// `Models:` line, so every question about a command without an entry of its own
// answered with a heading and nothing under it. Now both come from the same
// table: the section says which commands it holds, and the answer quotes it.
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from './commands-registry.mjs';
import { commandsOf, DOC_URL, sectionFor } from './help-sections.mjs';
import { t } from '../core/i18n.mjs';

/** How many commands a word search may list before it stops being an answer. */
const SEARCH_LIMIT = 3;

/** A CJK word is two characters where a Latin one needs three. */
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Commands whose own sentence mentions this word.
 *
 * `/help ветка` answered "no command /ветка" while the sentence explaining
 * branching sat one line away: the lookup matched command names only. The
 * sentences are the bot's own text in the chat's language, so searching them
 * searches what the person would read. Three characters is the floor — a shorter
 * word matches half the list and answers nothing — and two for a CJK word, where
 * two characters are a word and not a fragment.
 */
export function findCommands(word, lang, t) {
  const needle = String(word || '').trim().toLowerCase();
  if (needle.length < (CJK.test(needle) ? 2 : 3)) return [];
  const hits = [];
  for (const name of DOCUMENTED_COMMANDS) {
    const about = String(t(lang, `ctrl.help.about.${name}`) || '');
    if (about.startsWith('ctrl.help.about.')) continue;
    if (about.toLowerCase().includes(needle)) hits.push(name);
    if (hits.length >= SEARCH_LIMIT) break;
  }
  return hits;
}

/**
 * The explanation for one command, or '' when there is no such command.
 * A command with a sentence of its own gets it; the rest get the line from
 * /help that lists them, so a reader still sees the command in context.
 */
export function explainCommand(name, lang, t) {
  const typed = String(name || '').trim().toLowerCase().replace(/^\//, '');
  if (!CONTROL_COMMANDS.includes(typed)) {
    // Not a name — but it may be the word somebody actually has in mind.
    const hits = findCommands(typed, lang, t);
    if (!hits.length) return '';
    const body = hits.map((hit) => `/${hit} — ${t(lang, `ctrl.help.about.${hit}`)}`).join('\n\n');
    return `${t(lang, 'help.found', { word: typed })}\n\n${body}`;
  }
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