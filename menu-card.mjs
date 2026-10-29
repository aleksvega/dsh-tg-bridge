// /menu: the whole bot as buttons, for "how do I use this without spelling
// commands". Every button runs the command a person would otherwise type, so the
// panel is a shortcut and never a second implementation.
//
// Two shapes, both driven by inline keyboards that edit themselves in place:
//   the hub     — six sections, one button each, and a close button;
//   a section   — the commands of one job, a way back, and a way onward.
// A section teaches the command names by showing them, which is why the labels
// are the commands themselves. Nothing here advertises an old spelling.
import { CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from './commands-registry.mjs';

/**
 * Six sections, in the order a person usually needs them. Every documented
 * command appears exactly once except `/menu`, which is where you already are:
 * a panel that hides half the bot sends people back to typing.
 */
const SECTIONS = {
  work: ['cd', 'seed', 'send'],
  session: ['sessions', 'rewind', 'profile', 'agents'],
  goals: ['goal', 'task', 'tasks', 'plan', 'jobs', 'remind'],
  talk: ['effort', 'reasoning', 'pin', 'thoughts', 'prices', 'lang', 'fallback'],
  ext: ['plugins', 'skills', 'soul', 'preset', 'permissions', 'crew'],
  house: ['load', 'settings', 'update', 'subscribe', 'doctor', 'logs', 'report', 'restart', 'app', 'help'],
};

/**
 * The four presses of an ordinary day, on the first card. They are here instead
 * of in a section because reaching them must cost one tap, not two: a panel that
 * asks "which section is /status in" is a second thing to learn.
 */
const QUICK = ['status', 'model', 'new', 'stop'];

export const MENU_GROUPS = Object.keys(SECTIONS);

/** Commands the panel shows, in order, deduplicated, and all of them real. */
export function menuCommands() {
  const known = new Set(DOCUMENTED_COMMANDS);
  const out = QUICK.filter((name) => known.has(name));
  for (const group of Object.values(SECTIONS)) {
    for (const name of group) if (known.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Documented commands the panel does not reach. Should only ever be `/menu`. */
export function unlistedCommands() {
  const shown = new Set(menuCommands());
  return DOCUMENTED_COMMANDS.filter((name) => !shown.has(name) && name !== 'menu');
}

export const MENU_PREFIX = 'mn:';

export function isMenuPress(value) {
  return String(value || '').startsWith(MENU_PREFIX);
}

/** The label a button carries: the command itself, with its argument if it needs one. */
const LABELS = {
  cd: '/cd <project>',
  seed: '/seed <text>',
  send: '/send <file>',
  stop: '/stop',
  sessions: '/sessions [<id>]',
  rewind: '/rewind [n|fork|branches]',
  profile: '/profile <name>',
  agents: '/agents',
  goal: '/goal <text>',
  task: '/task <text>',
  tasks: '/tasks',
  plan: '/plan',
  jobs: '/jobs',
  remind: '/remind +15m',
  model: '/model <id>',
  effort: '/effort <level>',
  reasoning: '/reasoning',
  thoughts: '/thoughts',
  prices: '/prices',
  fallback: '/fallback',
  lang: '/lang en|ru|zh',
  plugins: '/plugins add|rm',
  skills: '/skills',
  soul: '/soul',
  preset: '/preset <id>',
  permissions: '/permissions',
  crew: '/crew use <id>',
  settings: '/settings',
  update: '/update [confirm]',
  subscribe: '/subscribe on|off',
  doctor: '/doctor',
  logs: '/logs [N]',
  restart: '/restart confirm',
  app: '/app',
  help: '/help <command>',
  status: '/status',
  new: '/new',
};

/** Callback data. Kept short: Telegram allows 64 bytes per button. */
const press = (name) => `${MENU_PREFIX}c:${name}`;
const section = (name) => `${MENU_PREFIX}g:${name}`;
const HUB = `${MENU_PREFIX}h`;
const CLOSE = `${MENU_PREFIX}x`;

/** The hub: the daily four, then the sections, then the way out. */
function renderHub({ t }) {
  const rows = [];
  QUICK.forEach((name, index) => {
    const button = { text: t(`ctrl.menu.quick.${name}`), data: press(name) };
    if (index % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  MENU_GROUPS.forEach((group, index) => {
    const button = { text: t(`ctrl.menu.group.${group}`), data: section(group) };
    if (index % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  rows.push([{ text: t('ctrl.menu.close'), data: CLOSE }]);
  return {
    text: [t('ctrl.menu.title'), '', t('ctrl.menu.lead'), '', t('ctrl.menu.foot')].join('\n'),
    keyboard: rows,
    page: '',
  };
}

/**
 * One section: its commands in rows of two, then back / onward / close. Two per
 * row because a label like `/lang en|ru|zh` needs the width on a phone.
 */
function renderSection({ t, page }) {
  const names = SECTIONS[page];
  if (!names) return null;
  const rows = [];
  names.forEach((name, index) => {
    const button = { text: LABELS[name] || `/${name}`, data: press(name) };
    if (index % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  const order = MENU_GROUPS.indexOf(page);
  const next = MENU_GROUPS[(order + 1) % MENU_GROUPS.length];
  rows.push([{ text: t('ctrl.menu.back'), data: HUB }]);
  rows.push([
    { text: t('ctrl.menu.next', { name: t(`ctrl.menu.group.${next}`) }), data: section(next) },
    { text: t('ctrl.menu.close'), data: CLOSE },
  ]);
  return {
    text: [
      t('ctrl.menu.section', { name: t(`ctrl.menu.group.${page}`), at: order + 1, of: MENU_GROUPS.length }),
      '',
      t(`ctrl.menu.hint.${page}`),
    ].join('\n'),
    keyboard: rows,
    page,
  };
}

/**
 * The card for one page: no argument is the hub, a known section is that
 * section. A section name that does not exist falls back to the hub rather than
 * to an empty card.
 */
export function renderPanel({ t, page = '' }) {
  if (!page) return renderHub({ t });
  return renderSection({ t, page }) || renderHub({ t });
}

/** Which page a press asks for, before any command runs. */
export function menuTarget(data) {
  const rest = String(data || '').slice(MENU_PREFIX.length);
  if (rest === 'h') return { kind: 'hub' };
  if (rest === 'x') return { kind: 'close' };
  if (rest.startsWith('g:')) return { kind: 'section', page: rest.slice(2) };
  if (rest.startsWith('c:')) return { kind: 'command', name: rest.slice(2) };
  return { kind: 'unknown' };
}

/** What a person typed, from a button label: the command itself. */
export function commandForName(name, { t }) {
  if (!CONTROL_COMMANDS.includes(name)) return '';
  // A press runs the command, bare, exactly as if it had been typed. A command
  // that wants an argument answers with its own usage line or its own card, which
  // is the useful answer — an explanation page is not. The two that change
  // something when typed alone are the exception: a stray tap must not start a
  // new session or kill a running turn, so they open their explanation.
  if (CHANGES_ALONE.includes(name)) return `/help ${name}`;
  return `/${name}`;
}

/**
 * Commands whose bare form would be a no-op or a surprise. `/new` and `/stop`
 * would change something nobody asked for; the rest need a word after them.
 */
const CHANGES_ALONE = ['new', 'stop'];

/** Whether a press labelled `name`, tapped on its own, is safe to run. */
export function runsUnasked(name) {
  return !CHANGES_ALONE.includes(name);
}

/**
 * The persistent keyboard `/menu on` puts under the message field: four things
 * that are useful in any topic, and nothing that needs an argument. It is a
 * Telegram reply keyboard, so it stays until `/menu off`.
 */
export function replyKeyboard({ t }) {
  return [
    [{ text: t('ctrl.menu.key.status') }, { text: t('ctrl.menu.key.menu') }],
    [{ text: t('ctrl.menu.key.stop') }, { text: t('ctrl.menu.key.new') }],
  ];
}

/** The words those keys send. A reply key sends its own label as the message. */
export function keyboardCommand(label, { t }) {
  const map = {
    [t('ctrl.menu.key.status')]: '/status',
    [t('ctrl.menu.key.menu')]: '/menu',
    [t('ctrl.menu.key.stop')]: '/stop',
    [t('ctrl.menu.key.new')]: '/new',
  };
  return map[String(label || '').trim()] || '';
}
