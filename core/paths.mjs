// Where everything lives. Constants only — no reads, no writes, no mkdir.
//
// Split out of `bridge.mjs` because half the modules that follow need one of
// these paths and importing the poller to get one is how the giant stayed giant.
// A module that only needs `DIR` can now say so.
import { homedir } from 'node:os';
import { join, posix, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = homedir();
export const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh');
// State, config and logs live here. DSH_TG_HOME lets a checkout run with its own
// directory instead of the default ~/.dsh/tg-bridge.
export const DIR = process.env.DSH_TG_HOME || join(DSH_HOME, 'tg-bridge');
// Code directory can differ from DIR when the bridge is started by the DSH
// plugin (code lives in the profile's node_modules, state stays in DIR).
// This module sits one folder down (`core/`), so `..` is the code root: every
// path below names a file the root still holds, and `goal.mjs` is the entry the
// agent types, not a library.
export const SELF_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GOAL_CMD = join(SELF_DIR, 'goal.mjs');
export const STATE = join(DIR, 'state.json');
export const LOG = join(DIR, 'bridge.log');
export const CRED = join(DSH_HOME, '.credentials.yaml');
export const PENDING_DIR = join(DIR, 'pending');
export const STEER_DIR = join(DIR, 'steer');
export const THOUGHT_DIR = join(DIR, 'thoughts');
// The helper the agent calls to confirm an addition in the chat while the turn
// is still running. Lives next to the bridge so an installed copy works too.
export const SAY = join(DIR, 'say.mjs');
export const DONE_FILE = join(DIR, 'done.json');
export const RESTART_MARKER = join(DIR, 'restart.pending');
// `/restart confirm` leaves a note here for the process that replaces it: the
// old code exits ~300 ms after spawning the new one, and without this the chat
// saw "Перезапускаю мост…" and then silence — no proof the bot came back.
export const RESTART_NOTICE = join(SELF_DIR, 'restart-notice.json');
export const DONE_TTL_MS = 24 * 60 * 60 * 1000;
// Where the DSH app lives, per platform. This used to be the Windows path
// unconditionally: LOCALAPPDATA is empty on macOS and Linux, so APP became the
// RELATIVE "Programs/DeepSeek Harness" and every turn spawned a file that cannot exist.
//
// Two shapes: a plain directory holding the binary with a `resources/` next to
// it (Windows, Linux), or a bundle with Contents/MacOS and Contents/Resources.
// A function, not just constants, so a test can ask about a platform this
// machine is not.
export function appPaths(platform = process.platform, env = process.env, home = HOME) {
  // `path.join` is the HOST separator: on a Windows machine it turns
  // '/Applications/x' into '\\Applications\\x'. The paths must be joined in the
  // separator of the platform being described, not the one running the test.
  const J = platform === 'win32' ? join : posix.join;
  const app = env.DSH_APP_DIR || (
    platform === 'win32'
      ? J(env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness')
      : platform === 'darwin'
        ? '/Applications/DeepSeek Harness.app'
        : J(home, '.local', 'share', 'DeepSeek Harness')
  );
  const bundle = platform === 'darwin';
  const resources = bundle ? J(app, 'Contents', 'Resources') : J(app, 'resources');
  const bin = bundle ? J(app, 'Contents', 'MacOS') : app;
  return {
    app,
    exe: J(bin, platform === 'win32' ? 'DeepSeek Harness.exe' : 'DeepSeek Harness'),
    cli: J(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
    cmd: J(resources, 'runtime', 'cli', 'bin', platform === 'win32' ? 'dsh.cmd' : 'dsh'),
  };
}
const LOCAL = appPaths();
// The Electron binary, and the CLI entrypoint it runs as Node. dsh.cmd is the
// same thing on Windows, and the bridge mirrors it so no shell quoting of task
// text is needed.
export const APP = LOCAL.app;
export const EXE = LOCAL.exe;
export const CLI_JS = LOCAL.cli;
export const DSH_CMD = LOCAL.cmd;
// One directory per profile: a profile is a plugin set plus a patch of settings.
export const PROFILES = join(DSH_HOME, 'profiles');
// Single instance: the watchdog task re-runs this every few minutes, so a live
// pid means another bridge already owns the bot's getUpdates loop (two pollers
// make Telegram answer 409 and both go silent).
export const PID_FILE = join(DIR, 'bridge.pid');
