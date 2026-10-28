// The command registry: what exists, what is an alias, what may be advertised.
//
// A module of its own because both directions of the old cycle needed it:
// `control.mjs` dispatches on this list, and `menu-card.mjs` plus
// `help-explain.mjs` render it. Importing it from `control.mjs` made the
// renderers import the dispatcher that imports them, which Node reports as
// `undefined is not a function` three frames away instead of as a cycle. This
// file imports nothing, so it can never be part of one.
export const CONTROL_COMMANDS = [
  'status', 'models', 'model', 'effort', 'profile', 'agents', 'preset', 'permissions', 'plan',
  'jobs', 'remind', 'sessions', 'resume', 'plugins', 'plugin',
  'skills', 'soul', 'restart', 'app', 'stop', 'new', 'seed', 'send', 'cd',
  'prices', 'help', 'doctor', 'logs', 'lang', 'reasoning', 'goal', 'task', 'tasks',
  'thoughts', 'version', 'update', 'crew', 'agentset', 'subscribe', 'settings',
  'rewind', 'fork', 'branches', 'menu',
];

/**
 * Old spellings that no longer have a job of their own. A phone keyboard turns
 * `task` into `tasks` and `model` into `models` without the person noticing, so
 * each pair is ONE command: one name in `/help` and the panel, and the other
 * spelling quietly routed to it. A name that is documented is a name a person
 * can mistype; a name that is not documented is a name nobody has to remember.
 */
export const COMMAND_ALIASES = {
  models: 'model',
  plugin: 'plugins',
  agentset: 'crew',
};

/**
 * What `/help`, the panel and the Telegram menu are allowed to say. Aliases are
 * deliberately absent: they work, and they are never advertised.
 */
export const DOCUMENTED_COMMANDS = CONTROL_COMMANDS.filter((name) => !COMMAND_ALIASES[name]);
