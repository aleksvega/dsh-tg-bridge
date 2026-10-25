// Which control commands may run while a turn is still working?
//
// Everything in a topic used to be queued, so `/stop` waited for the very turn
// it was supposed to kill, and a report typed during a long turn was answered
// only when that turn ended — which looks exactly like silence. The rule is not
// "important commands" but "commands that do not touch the turn's session":
//
//   * always immediate — reports, turn control, and settings that only affect
//     the next turn (`/model`, `/lang`, `/goal`, `/thoughts`, unknown commands
//     that deserve an instant "no such command");
//   * queued — `/new`, `/resume`, `/seed`, `/send` (they replace or feed the
//     session the running turn is writing) and plugin mutations (pnpm install
//     must not race a turn).

const QUEUED = new Set(['new', 'resume', 'seed', 'send']);
const PLUGIN_ACTIONS = new Set(['add', 'remove', 'disable', 'enable']);

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
  if (QUEUED.has(command)) return '';
  if (command === 'plugins' || command === 'plugin') {
    const [action = ''] = args;
    return PLUGIN_ACTIONS.has(String(action).toLowerCase()) ? '' : command;
  }
  return command;
}
