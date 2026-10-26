// /menu: the control panel, opened by a command and gone after a press.
//
// The settings card already answers "what can I change"; this answers a wider
// question — what can this bot do at all — and it is the answer to "how do I
// stop typing commands I cannot spell". Every button is a command, so the panel
// is a shortcut, never a second implementation: a press runs the same handler a
// typed command would.
import { CONTROL_COMMANDS } from './control.mjs';

/**
 * The groups, in the order a person usually needs them. A group lists commands
 * that belong to one job, and the first one is the safest (read-only) one.
 * Commands not listed here are reachable from /help and stay out of the panel:
 * a panel that mirrors every command is the help text with buttons again.
 */
const GROUPS = {
  work: ['status', 'new', 'cd', 'stop'],
  talk: ['model', 'effort', 'reasoning', 'lang'],
  session: ['sessions', 'rewind', 'profile', 'agents'],
  house: ['settings', 'update', 'doctor', 'help'],
};

export const MENU_GROUPS = Object.keys(GROUPS);

/** Commands the panel shows, in order, deduplicated, and all of them real. */
export function menuCommands() {
  const known = new Set(CONTROL_COMMANDS);
  const out = [];
  for (const group of Object.values(GROUPS)) {
    for (const name of group) if (known.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Callback data for one panel button. */
const data = (name) => `mn:${name}`;

export const MENU_PREFIX = 'mn:';

export function isMenuPress(value) {
  return String(value || '').startsWith(MENU_PREFIX);
}

/**
 * One group per row, plus a footer that says how the panel behaves. The text is
 * short on purpose: the buttons carry the labels, and a person reading the card
 * for the first time needs the rule ("a press replaces this") more than a lesson.
 */
export function renderPanel({ t, page = 'work' }) {
  const names = GROUPS[page];
  if (!names) return null;
  const lines = [t('ctrl.menu.title'), '', t('ctrl.menu.lead')];
  const row = names.map((name) => ({
    text: t(`ctrl.menu.item.${name}`),
    data: data(name),
  }));
  const tabs = MENU_GROUPS.map((group) => ({
    text: group === page ? `— ${t(`ctrl.menu.group.${group}`)} —` : t(`ctrl.menu.group.${group}`),
    data: `mn:g:${group}`,
  }));
  return { text: [...lines, '', t('ctrl.menu.foot')].join('\n'), keyboard: [row, tabs], page };
}

/** What a person typed, from a button label: the command itself. */
export function commandForName(name, { t }) {
  if (!CONTROL_COMMANDS.includes(name)) return '';
  // A command that needs an argument cannot be run by one press; the press
  // opens its explanation instead, which says what to type.
  const bare = ['cd', 'resume', 'seed', 'send', 'effort', 'logs', 'rewind'];
  if (bare.includes(name)) return `/help ${name}`;
  return `/${name}`;
}

/**
 * Whether `/menu` done alone would change something. Almost every command only
 * reports what is already true; `new` and `stop` do not, and a stray tap on them
 * would be a command nobody asked for. Those open their explanation instead.
 */
const CHANGES_ALONE = ['new', 'stop'];

/** Whether a press labelled `name`, tapped on its own, is safe to run. */
export function runsUnasked(name) {
  return !CHANGES_ALONE.includes(name);
}