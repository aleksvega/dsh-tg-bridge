// Arguments for one headless DSH turn.
//
// The launcher parses its own flags (`--profile`, `--patch`, `--dump-config`)
// and stops at the first flag it does not recognise, handing that flag and
// everything after it to the app. So launcher options must come first: with
// `--json ... --patch x.yml` the app received `--patch`, answered
// `{"type":"error","message":"unknown option '--patch'"}` and exited 1 — every
// photo turn and every fallback-model attempt died in about five seconds.
export function turnArgs({ cli, profile, extraArgs = [], sessionId = '', task }) {
  if (!cli) throw new Error('turnArgs: cli path is required');
  if (!profile) throw new Error('turnArgs: profile is required');
  if (typeof task !== 'string' || !task) throw new Error('turnArgs: task is required');
  const args = ['--expose-internals', cli, '--profile', profile, ...extraArgs, '--json'];
  if (sessionId) args.push('--session-id', sessionId);
  args.push(task);
  return args;
}
