// Which control commands may run while a turn is still working?
//
// Everything in a topic used to be queued, so `/stop` waited for the very turn
// it was supposed to kill. The rule here is not "important commands", it is
// "commands that neither read nor write the state of the running turn".
//
// Groups:
//   * always immediate — read-only reports and turn control;
//   * immediate only without arguments — the bare form reports, the form with
//     an argument changes state (`/soul <text>`, `/lang en`);
//   * `/plugins` without an action — the list; with add/remove/disable/enable
//     it installs plugins, which must queue like any other mutation;
//   * everything else queues, because it changes the session the turn is using
//     (`/model`, `/new`, `/resume`, `/cd`, `/send`, `/seed`, `/plugin`).

const PLUGIN_ACTIONS = new Set(['add', 'remove', 'disable', 'enable']);

const ALWAYS = new Set([
  // Turn control.
  'stop',
  'restart',
  // Reports: they read profiles, sessions, skills and the price table, but
  // touch neither the queue nor the session of the running turn.
  'status',
  'logs',
  'help',
  'doctor',
  'models',
  'sessions',
  'skills',
  'prices',
]);

const BARE_ONLY = new Set([
  'soul', // `/soul` reads AGENTS.md, `/soul <text>` rewrites it
  'lang', // `/lang` reports the current language, `/lang en` switches it
]);

/**
 * Canonical immediate command name, or '' when the message must queue.
 * `name` is the command without the slash and without a bot mention,
 * `args` is everything after it, already split.
 */
export function immediateKind(name, args = []) {
  const command = String(name ?? '').toLowerCase();
  if (command === 'apprestart' || command === 'apprestartconfirm' || command === 'restartconfirm') {
    return 'restart';
  }
  if (ALWAYS.has(command)) return command;
  if (command === 'plugins') {
    const [action = ''] = args;
    return PLUGIN_ACTIONS.has(String(action).toLowerCase()) ? '' : 'plugins';
  }
  if (BARE_ONLY.has(command) && args.length === 0) return command;
  return '';
}
