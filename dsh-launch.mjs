// How to start one DSH turn on THIS machine.
//
// The bridge grew up on Windows, where DSH ships an Electron app: the turn is
// `[DSH].exe --expose-internals .../cli.js --profile headless --json "<task>"`.
// That path is a Windows path, and it was the only one in the code, so on macOS
// and Linux every turn spawned a file that does not exist — the README promised
// "Windows, macOS or Linux" and the turn runner quietly meant Windows. The
// plugin commands had already learned the alternative (`dsh` from PATH); this
// module makes that the one answer both of them share.
//
// Pure on purpose: platform, environment and the filesystem question are all
// arguments, so the table below is a test rather than a story about a machine.
import { appPaths } from './paths.mjs';


/**
 * @returns {{exe: string, lead: string[], kind: 'app'|'cli', why: string}}
 *   `lead` is what goes before `--profile`: the Electron binary needs the CLI
 *   entrypoint after `--expose-internals`, a plain `dsh` needs nothing.
 */
export function dshLaunch({
  platform = process.platform,
  env = process.env,
  exists = null,
  home = undefined,
} = {}) {
  const has = exists || (() => true);
  // The paths of the platform being asked about, not the one running the code:
  // a Windows machine must still be able to say what a Mac would do.
  const paths = home === undefined ? appPaths(platform, env) : appPaths(platform, env, home);

  // An explicit answer beats every guess: a user who moved the app, or runs a
  // checkout, should not have to patch the bridge.
  if (env.DSH_CLI_JS) {
    return { exe: env.DSH_BIN || paths.exe, lead: ['--expose-internals', env.DSH_CLI_JS], kind: 'app', why: 'DSH_CLI_JS' };
  }
  if (env.DSH_BIN && !env.DSH_BIN.toLowerCase().endsWith('.js')) {
    // A CLI binary needs no entrypoint argument: it IS the entrypoint.
    return { exe: env.DSH_BIN, lead: [], kind: 'cli', why: 'DSH_BIN' };
  }

  if (platform === 'win32') {
    // Windows is where DSH ships as an app, and it is where the bridge has
    // always run. If the app is not installed the turn fails with a message
    // naming the path, which beats a bare "dsh not found" from PATH.
    return { exe: paths.exe, lead: ['--expose-internals', paths.cli], kind: 'app', why: 'windows app' };
  }
  if (platform === 'darwin' && has(paths.exe)) {
    // The macOS bundle has the same shape as the Windows app, one directory up
    // from Resources; `appPaths()` already answers for it, so there is no second
    // copy of the layout to keep in step.
    return { exe: paths.exe, lead: ['--expose-internals', paths.cli], kind: 'app', why: 'macOS app' };
  }
  // Everything else: the `dsh` command on PATH. This is what the plugin
  // commands already did, and it is the one form that survives an install
  // method we cannot predict. The Windows `.cmd` shim is not a path that means
  // anything on Linux, so it is not reused here.
  return { exe: 'dsh', lead: [], kind: 'cli', why: `${platform} cli` };
}

/**
 * The binary, for a message a person reads. The CLI entrypoint is not appended:
 * it is a 120-character `app.asar` path that means nothing in a chat row, and
 * `kind` already says whether one is implied.
 */
export function describeLaunch(launch) {
  return launch.exe;
}
