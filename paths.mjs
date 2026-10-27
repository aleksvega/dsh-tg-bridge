// Where everything lives. Constants only — no reads, no writes, no mkdir.
//
// Split out of `bridge.mjs` because half the modules that follow need one of
// these paths and importing the poller to get one is how the giant stayed giant.
// A module that only needs `DIR` can now say so.
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = homedir();
export const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh');
// State, config and logs live here. DSH_TG_HOME lets a checkout run with its own
// directory instead of the default ~/.dsh/tg-bridge.
export const DIR = process.env.DSH_TG_HOME || join(DSH_HOME, 'tg-bridge');
// Code directory can differ from DIR when the bridge is started by the DSH
// plugin (code lives in the profile's node_modules, state stays in DIR).
export const SELF_DIR = dirname(fileURLToPath(import.meta.url));
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
// dsh.cmd runs the Electron binary as Node against this CLI entrypoint; the
// bridge mirrors that exactly so no shell quoting of task text is needed.
export const APP = join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
export const EXE = join(APP, 'DeepSeek Harness.exe');
export const CLI_JS = join(APP, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
// Single instance: the watchdog task re-runs this every few minutes, so a live
// pid means another bridge already owns the bot's getUpdates loop (two pollers
// make Telegram answer 409 and both go silent).
export const PID_FILE = join(DIR, 'bridge.pid');
