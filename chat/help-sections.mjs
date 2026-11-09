// What /help lists, and in which order.
//
// The old help was one paragraph per domain: complete enough to scan, impossible
// to ask a question about. Section membership lived in this module while the
// labels lived in `help.body` as prose, so `/help model` in Russian searched for
// a line starting with `Models:` in a Russian body, found nothing, and answered
// with a heading and no sentence. One table instead: the section names the
// commands, and both the chat answer and docs/COMMANDS.md are rendered from it.
import { COMMAND_ALIASES, CONTROL_COMMANDS } from './commands-registry.mjs';
import { currentBotUsername } from './commands.mjs';

/** The GitHub page with the full list, linked from every /help answer. */
export const DOC_URL = 'https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/COMMANDS.md';

/**
 * One row per command, in the order a person meets them. Every command in
 * `CONTROL_COMMANDS` belongs to exactly one section; a test enforces that, so a
 * new command cannot ship unlisted.
 */
export const HELP_SECTIONS = [
  { id: 'work', commands: ['start', 'cd', 'ls', 'view', 'edit', 'new', 'stop', 'send', 'seed', 'diff', 'find'] },
  { id: 'goals', commands: ['goal', 'tasks'] },
  { id: 'sessions', commands: ['status', 'sessions', 'rewind', 'regen', 'branch', 'history', 'profile', 'compact', 'card'] },
  { id: 'model', commands: ['model', 'effort', 'prices', 'cost', 'balance', 'thoughts', 'fallback', 'endpoint', 'load'] },
  { id: 'agents', commands: ['agents', 'crew', 'subagents', 'preset', 'plan', 'permissions'] },
  { id: 'tuning', commands: ['jobs', 'remind', 'every'] },
  { id: 'extensions', commands: ['skills', 'plugins', 'mcp', 'soul', 'remember'] },
  { id: 'versions', commands: ['update', 'subscribe', 'dsh'] },
  { id: 'settings', commands: ['settings', 'lang', 'reasoning', 'pin'] },
  { id: 'panels', commands: ['menu', 'help'] },
  { id: 'health', commands: ['doctor', 'logs', 'report', 'app', 'restart'] },
];

/** command → section id, built once. */
const SECTION_OF = new Map();
for (const section of HELP_SECTIONS) {
  for (const command of section.commands) SECTION_OF.set(command, section.id);
}

/** Which section a command belongs to (an old spelling answers for its owner). */
export function sectionFor(name) {
  const typed = String(name || '').trim().toLowerCase().replace(/^\//, '');
  return SECTION_OF.get(COMMAND_ALIASES[typed] || typed) || '';
}

/** Commands a section lists, as they read in a message. */
export const commandsOf = (id) => (HELP_SECTIONS.find((s) => s.id === id)?.commands || []).map((c) => `/${c}`);

/**
 * The /help message: one line per section, every command named once, and the
 * page that explains each of them. A section line is `name: /a, /b, …` so the
 * same text can be quoted when somebody asks about one command.
 */
export function helpLines(t) {
  const lines = [t('help.intro', { url: DOC_URL }), ''];
  for (const section of HELP_SECTIONS) {
    lines.push(`${t(`help.section.${section.id}`)}: ${commandsOf(section.id).join(' · ')}`);
  }
  // Inline mode stays invisible until @BotFather switches it on, and a person
  // who never hears about it reads the silence as "this bot cannot do that".
  lines.push('', t('help.inline', { bot: `@${currentBotUsername() || 'bot'}` }));
  return lines;
}

/** Every command this help claims to cover, for the drift test. */
export const HELP_COVERED = HELP_SECTIONS.flatMap((s) => s.commands);

/** Commands the registry knows and this help does not list. */
export function uncoveredCommands() {
  return CONTROL_COMMANDS.filter((c) => !SECTION_OF.has(c));
}

/** Commands listed more than once across sections. */
export function duplicatedCommands() {
  const seen = new Set();
  const dupes = [];
  for (const s of HELP_SECTIONS) {
    for (const c of s.commands) {
      if (seen.has(c)) dupes.push(c);
      seen.add(c);
    }
  }
  return dupes;
}