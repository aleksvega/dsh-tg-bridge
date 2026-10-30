// Arguments for one headless DSH turn.
//
// The launcher parses its own flags (`--profile`, `--patch`, `--dump-config`)
// and stops at the first flag it does not recognise, handing that flag and
// everything after it to the app. So launcher options must come first: with
// `--json ... --patch x.yml` the app received `--patch`, answered
// `{"type":"error","message":"unknown option '--patch'"}` and exited 1 — every
// photo turn and every fallback-model attempt died in about five seconds.
// `lead` is what goes before `--profile`, and it is not always
// `--expose-internals <cli.js>`: the Electron app needs that, a plain `dsh` on
// PATH needs nothing (see `dsh-launch.mjs`). Keeping `cli` as a fallback means
// the old call still reads the way it did.
export function turnArgs({ lead = null, cli, profile, extraArgs = [], sessionId = '', task }) {
  const prefix = lead || (cli ? ['--expose-internals', cli] : null);
  if (!prefix) throw new Error('turnArgs: lead or cli is required');
  if (!profile) throw new Error('turnArgs: profile is required');
  if (typeof task !== 'string' || !task) throw new Error('turnArgs: task is required');
  const args = [...prefix, '--profile', profile, ...extraArgs, '--json'];
  if (sessionId) args.push('--session-id', sessionId);
  args.push(task);
  return args;
}
