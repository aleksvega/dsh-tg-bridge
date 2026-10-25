// dsh-telegram-bridge — Telegram <-> DSH without any UI.
//
// Long-polls the Telegram Bot API and runs every message through
// `dsh --profile headless --json`, resuming one persisted DSH session per chat
// (and per forum topic inside a supergroup). No browser, no SPA panel, no
// dsh-im: the only moving parts are this process and the DSH CLI. Start it with
// the logon task (see README.md).
import { spawn } from 'node:child_process';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync,
  readdirSync, statSync, openSync, fsyncSync, closeSync, renameSync, writeFileSync as writeFd,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Force IPv4 for every fetch. DNS returns an AAAA next to the A record, and
// Happy Eyeballs happily picks the IPv6 path, which here costs ~5 s or dies
// outright ("fetch failed" every 6 s, measured 22.10.2026: IPv4 0.34 s, IPv6
// 5.3 s, IPv6 to GitHub 0.02 s refused). The --dns-result-order flag alone
// does not bind fetch/undici, so pin the family on the socket layer.
import dns from 'node:dns';
import net from 'node:net';
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);
import { noticeIsObsolete } from './queue-notice.mjs';
import { immediateKind } from './immediate.mjs';
import { writeSteerJob } from './steer-queue.mjs';
import { inlineText } from './media-text.mjs';
import { handleControl, CONTROL_COMMANDS, modelOf, reasoningOf } from './control.mjs';
import { drainGoalJobs, goalOf, renderPromptBlock } from './goals.mjs';
import { renderPrices } from './prices.mjs';
import { t, resolveLang } from './i18n.mjs';

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh');
// State, config and logs live here. DSH_TG_HOME lets a checkout run with its own
// directory instead of the default ~/.dsh/tg-bridge.
const DIR = process.env.DSH_TG_HOME || join(DSH_HOME, 'tg-bridge');
// Code directory can differ from DIR when the bridge is started by the DSH
// plugin (code lives in the profile's node_modules, state stays in DIR).
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const GOAL_CMD = join(SELF_DIR, 'goal.mjs');
const STATE = join(DIR, 'state.json');
const LOG = join(DIR, 'bridge.log');
const CRED = join(DSH_HOME, '.credentials.yaml');
const PENDING_DIR = join(DIR, 'pending');
const STEER_DIR = join(DIR, 'steer');
const THOUGHT_DIR = join(DIR, 'thoughts');
// The helper the agent calls to confirm an addition in the chat while the turn
// is still running. Lives next to the bridge so an installed copy works too.
const SAY = join(DIR, 'say.mjs');
const DONE_FILE = join(DIR, 'done.json');
const RESTART_MARKER = join(DIR, 'restart.pending');
// `/restart confirm` leaves a note here for the process that replaces it: the
// old code exits ~300 ms after spawning the new one, and without this the chat
// saw "Перезапускаю мост…" and then silence — no proof the bot came back.
const RESTART_NOTICE = join(fileURLToPath(new URL('.', import.meta.url)), 'restart-notice.json');
const DONE_TTL_MS = 24 * 60 * 60 * 1000;
// dsh.cmd runs the Electron binary as Node against this CLI entrypoint; the
// bridge mirrors that exactly so no shell quoting of task text is needed.
const APP = join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
const EXE = join(APP, 'DeepSeek Harness.exe');
const CLI_JS = join(APP, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');

mkdirSync(DIR, { recursive: true });

// Single instance: the watchdog task re-runs this every few minutes, so a live
// pid means another bridge already owns the bot's getUpdates loop (two pollers
// make Telegram answer 409 and both go silent).
const PID_FILE = join(DIR, 'bridge.pid');
try {
  const other = Number(readFileSync(PID_FILE, 'utf8').trim());
  if (Number.isInteger(other) && other > 0 && other !== process.pid) {
    try {
      process.kill(other, 0);
      process.exit(0);
    } catch {}
  }
} catch {}
writeFileSync(PID_FILE, String(process.pid), 'utf8');
/**
 * Silent deaths are undebuggable.
 *
 * A bridge launched by Task Scheduler has no console, so an uncaught error used
 * to kill the poller with nothing in bridge.log but "bridge started" — from the
 * outside the bot simply stopped answering. Every fatal path now leaves a line
 * with the stack in bridge.log, and the exit hook records the code so a kill by
 * Task Scheduler (0xC000013A) is distinguishable from a Node crash (1).
 */
process.on('uncaughtException', (error) => {
  log(`FATAL uncaught: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log(`FATAL unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
});
process.on('exit', (code) => {
  log(`bridge exiting code=${code}`);
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE);
  } catch {}
});

const config = {
  allowedUserIds: [],
  profile: 'headless',
  cwd: join(HOME, 'Documents', 'deepseek-harness', 'default-workspace'),
  turnTimeoutMs: 20 * 60 * 1000,
};
/** Turns currently running, keyed like sessions — `/stop` kills one. */
const activeTurns = new Map();
/** Session id each running turn actually adopted, learned from its `session` event. */
const liveSessions = new Map();
/** Wall-clock start of the running turn per session key, for the queue notice. */
const turnStartedAt = new Map();
try {
  Object.assign(config, JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8')));
} catch {}
// Old installs wrote these paths relative to the bridge directory, but turns
// run from the project cwd, where "./transcribe.py" does not exist. Resolve
// once at load so voice and vision work regardless of the topic's directory.
if (config.voice?.script && !isAbsolute(config.voice.script)) config.voice.script = join(DIR, config.voice.script);
if (config.vision?.patch && !isAbsolute(config.vision.patch)) config.vision.patch = join(DIR, config.vision.patch);

const state = (() => {
  if (!existsSync(STATE)) return { offset: 0, sessions: {} };
  try {
    // Strip a UTF-8 BOM: PowerShell's Set-Content adds one and JSON.parse rejects it.
    return JSON.parse(readFileSync(STATE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { offset: 0, sessions: {} };
  }
})();
/** Atomic write: temp file, fsync, rename — a torn state.json loses sessions. */
function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try {
    writeFd(fd, text, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function saveState() {
  writeAtomic(STATE, JSON.stringify(state, null, 2));
}

/**
 * Which profile runs this topic's turns. `/profile <name>` binds one topic to
 * its own plugin set and model; every other topic keeps the install default.
 */
function profileOf(key) {
  return (state.profiles && state.profiles[key]) || config.profile || 'headless';
}

// The agent updates the topic goal list by dropping a job file (goal.mjs);
// the bridge is the only writer of state.json, so there is no lock race.
const GOAL_DIR = join(DIR, 'goal-jobs');
setInterval(() => {
  try {
    if (drainGoalJobs(state, GOAL_DIR, join(GOAL_DIR, 'done'))) saveState();
  } catch (error) {
    log(`goal job failed: ${error.message}`);
  }
}, 2000).unref();

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  try { appendFileSync(LOG, text, 'utf8'); } catch {}
  process.stdout.write(text);
}

// ---------------------------------------------------------------- журнал ходов
//
// A restart used to swallow whatever message was mid-flight: `offset` advanced
// before the turn ran, so nothing ever replayed it. The journal is written
// BEFORE the offset moves and deleted only after the answer reached Telegram,
// which is the one order that survives a crash (Hermes' update_admission).

/** update ids already answered, persisted, TTL-bound. */
const done = (() => {
  try {
    const raw = JSON.parse(readFileSync(DONE_FILE, 'utf8'));
    const cutoff = Date.now() - DONE_TTL_MS;
    return new Map(Object.entries(raw).filter(([, at]) => Number(at) > cutoff));
  } catch {
    return new Map();
  }
})();

function saveDone() {
  try {
    writeAtomic(DONE_FILE, JSON.stringify(Object.fromEntries(done), null, 0));
  } catch (error) {
    log(`done.json write failed: ${error.message}`);
  }
}

function pendingPath(updateId) {
  return join(PENDING_DIR, `${updateId}.json`);
}

/** Persist one update before it is processed. */
function writePending(update) {
  try {
    mkdirSync(PENDING_DIR, { recursive: true });
    writeAtomic(pendingPath(update.update_id), JSON.stringify(update));
    return true;
  } catch (error) {
    log(`pending write failed for ${update.update_id}: ${error.message}`);
    return false;
  }
}

/** Mark answered: remember the id and drop the file. Called AFTER the send. */
function ack(updateId) {
  done.set(String(updateId), Date.now());
  saveDone();
  try {
    unlinkSync(pendingPath(updateId));
  } catch {}
}

/** Ids of pending updates still owed an answer, oldest first. */
function pendingUpdates() {
  try {
    mkdirSync(PENDING_DIR, { recursive: true });
    const cutoff = Date.now() - DONE_TTL_MS;
    const out = [];
    for (const file of readdirSync(PENDING_DIR)) {
      if (!file.endsWith('.json')) continue;
      const id = Number(file.replace(/\.json$/, ''));
      const full = join(PENDING_DIR, file);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      // Older than the TTL: Telegram will not replay it either, drop it.
      if (stat.mtimeMs < cutoff) {
        try { unlinkSync(full); } catch {}
        continue;
      }
      if (!Number.isInteger(id) || done.has(String(id))) {
        try { unlinkSync(full); } catch {}
        continue;
      }
      try {
        out.push({ update: JSON.parse(readFileSync(full, 'utf8')), id });
      } catch {
        try { unlinkSync(full); } catch {}
      }
    }
    return out.sort((a, b) => a.id - b.id);
  } catch {
    return [];
  }
}

function readSecret(name) {
  const yaml = readFileSync(CRED, 'utf8');
  const re = new RegExp(`^\\s*${name}:\\s*["']?([^"'\\s]+)`, 'm');
  const m = yaml.match(re);
  return m ? m[1] : '';
}

/**
 * Env vars for the provider keys this install needs.
 *
 * A headless turn inherits the bridge's environment, and the credentials
 * service only resolves providers the app knows about. Extra providers are
 * therefore declared per install in `config.json` as
 * `"providerKeys": ["MY_PROVIDER_API_KEY"]`, and each name is read from
 * `~/.dsh/.credentials.yaml` under the same name. Nothing is hardcoded: an
 * install that runs on the app's own providers sets an empty list and gets
 * exactly the inherited environment.
 */
function providerKeys(cfg) {
  const out = {};
  const names = Array.isArray(cfg.providerKeys) ? cfg.providerKeys : [];
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(name))) continue;
    try {
      const value = readSecret(name) || (process.env[name] || '').trim();
      if (value) out[name] = value;
    } catch {}
  }
  return out;
}

/**
 * The bot token can be stored under three names: the plain one that `dsh-tg
 * init` writes, the suffixed one DSH generates when the secret is added through
 * the app, or an env var. Checking only the suffixed name made a fresh install
 * fail with "token not found" even though init had just written it.
 */
function findToken() {
  const env = (process.env.DSH_TELEGRAM_BOT_TOKEN || '').trim();
  if (env) return env;
  for (const name of ['DSH_TELEGRAM_BOT_TOKEN', 'DSH_TELEGRAM_BOT_TOKEN_3278A97027814C501779F5E2']) {
    try {
      const value = readSecret(name);
      if (value) return value;
    } catch {}
  }
  try {
    const m = readFileSync(CRED, 'utf8').match(/^\s*(DSH_TELEGRAM_BOT_TOKEN[A-Z0-9_]*):\s*["']?([^"'\s]+)/m);
    if (m) return m[2];
  } catch {}
  return '';
}
const token = findToken();
if (!token) {
  log('FATAL: bot token not found — run `node cli.mjs init --token <t> --user <id>` or set DSH_TELEGRAM_BOT_TOKEN');
  process.exit(1);
}
const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

/**
 * Telegram API call with retries.
 *
 * The log filled with `poll error: fetch failed` for an hour while
 * api.telegram.org was reachable over IPv4: Node's fetch tries the AAAA record
 * first and fails, and a single failed attempt used to drop the message or the
 * reply entirely. Three attempts with backoff turn a flaky network into a
 * short delay instead of silence.
 */
async function tg(method, body, timeoutMs = 60000, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(api(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`);
      return json.result;
    } catch (error) {
      lastError = error;
      const retryable = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|502|503|504/i.test(String(error?.message ?? error));
      if (!retryable || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function chunk(text, size = 4000) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.length) out.push(rest);
  return out;
}

/**
 * Forum topic id of a message, or 0 for the General topic and for private chats.
 * Telegram omits `message_thread_id` for the General topic of a forum, so 0 is
 * the "no topic" marker and must never be sent back as a thread id.
 */
function threadOf(msg) {
  const id = msg.message_thread_id ?? msg.reply_to_message?.message_thread_id;
  return Number.isInteger(id) && id > 0 ? id : 0;
}

/** One DSH session per chat, and per topic inside a forum supergroup. */
function sessionKey(chatId, threadId) {
  return threadId > 0 ? `${chatId}:${threadId}` : String(chatId);
}

/**
 * Last topic this chat actually worked in.
 *
 * Mirrors Hermes' `_recover_telegram_topic_thread_id`: when a message arrives
 * without a thread id (Telegram omits it for General and for clients that have
 * not bound the topic yet), routing it to the root session silently forks the
 * conversation. Recovering the newest bound topic keeps one project in one
 * place instead of scattering it between General and its topic.
 */
function newestBoundTopic(chatId) {
  let newest = 0;
  let at = 0;
  for (const key of Object.keys(state.sessions ?? {})) {
    const match = new RegExp(`^${chatId}:(\\d+)$`).exec(key);
    if (!match) continue;
    const stamped = state.topicTouched?.[match[1]] ?? 0;
    if (stamped > at) {
      at = stamped;
      newest = Number(match[1]);
    }
  }
  return newest;
}

/** Remember that a topic is active, for {@link newestBoundTopic}. */
function touchTopic(threadId) {
  if (!(threadId > 0)) return;
  state.topicTouched = state.topicTouched ?? {};
  state.topicTouched[String(threadId)] = Date.now();
}

/**
 * Recent topic seeds, so a duplicate of the same text arriving in the General
 * chat can be recognised instead of starting a second turn.
 *
 * Telegram delivers a brand-new topic's text twice: once as the topic message
 * and once as a plain group message. Both used to run a turn, which is why a
 * prompt written in General got answered in General while its topic stayed
 * empty.
 */
const recentSeeds = new Map();

function noteSeed(text, threadId) {
  const key = String(text ?? '').trim().slice(0, 200);
  if (!key) return;
  recentSeeds.set(key, { threadId, at: Date.now() });
  for (const [candidate, value] of recentSeeds) {
    if (Date.now() - value.at > 600000) recentSeeds.delete(candidate);
  }
}

/** Topic id whose seed carried this same text within the last ten minutes, or 0. */
function topicSeededRecently(text) {
  const key = String(text ?? '').trim().slice(0, 200);
  if (!key) return 0;
  const hit = recentSeeds.get(key);
  return hit && Date.now() - hit.at < 600000 ? hit.threadId : 0;
}

/**
 * Download a Telegram file into the bridge dir under a stable name.
 * Voice notes arrive as OGG/Opus, which the local ASR CLI does not decode,
 * so the caller passes the name it wants (including the extension).
 */
/** Upload a local file to the chat: archives, PDFs, screenshots, builds. */
async function sendFile(chatId, threadId, filePath, caption = '') {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.set('chat_id', String(chatId));
  if (threadId > 0) form.set('message_thread_id', String(threadId));
  if (caption) form.set('caption', caption.slice(0, 1000));
  form.set('document', new Blob([buf]), basename(filePath));
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`sendDocument: ${json.description || res.status}`);
  log(`sent file ${basename(filePath)} (${buf.length} B) chat=${chatId}`);
  return json.result;
}

async function downloadFile(fileId, fileName) {
  const file = await tg('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`file download failed: ${res.status}`);
  const path = join(DIR, fileName);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/**
 * Transcribe a local audio file with the speech backend from config.
 *
 * Two shapes are supported:
 *   - faster-whisper script: `voice.python` + `voice.script` + `voice.model`
 *     (the local setup: `~/.venv-whisper`, models from the HF cache);
 *   - any whisper.cpp-style CLI: `voice.command` + `voice.args`, with `{file}`.
 * Either way the transcript comes back on stdout, diagnostics on stderr.
 */
function transcribe(file, voice) {
  const useScript = Boolean(voice.python && voice.script);
  const command = useScript ? voice.python : voice.command;
  const args = useScript
    ? [
        voice.script,
        file,
        '--model', voice.model || 'small',
        '--language', voice.language || 'auto',
        '--beam', String(voice.beam ?? 1),
        '--threads', String(voice.threads ?? 0),
      ]
    : (voice.args ?? []).map((arg) => String(arg).replaceAll('{file}', file));
  if (!useScript && !(voice.args ?? []).some((arg) => String(arg).includes('{file}'))) args.push(file);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: voice.cwd || DIR,
      windowsHide: true,
      env: { ...process.env },
    });
    if (voice.timeoutMs) {
      const timer = setTimeout(() => child.kill(), voice.timeoutMs);
      child.on('close', () => clearTimeout(timer));
    }
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (buf) => { stdout += buf; });
    child.stderr.on('data', (buf) => { stderr += buf; });
    child.on('error', (err) => resolve({ text: '', error: `${command}: ${err.message}` }));
    child.on('close', (code) => {
      // whisper.cpp writes timestamps and `[BLANK_AUDIO]` markers; keep only speech.
      const text = stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\[[\d:.,\s>-]+\]\s*/, '').replace(/\[BLANK_AUDIO\]/gi, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      resolve({ text, error: code === 0 ? '' : `${voice.command} exit ${code}: ${stderr.trim().slice(-300)}` });
    });
  });
}

/** <audio file> -> transcript, wrapping every failure in a spoken-to text message. */
async function voiceToText(msg, voice) {
  const media = msg.voice || msg.audio || msg.document || msg.video_note;
  const file_id = media?.file_id;
  if (!file_id) return { text: '', error: 'no audio file in message' };
  // Voice notes are Opus-in-OGG: the extension follows the source so the
  // decoder picks the right container.
  const ext = msg.voice ? 'ogg' : msg.audio ? (msg.audio.mime_type?.includes('wav') ? 'wav' : 'mp3') : 'ogg';
  const path = await downloadFile(file_id, `voice-${Date.now()}.${ext}`);
  const result = await transcribe(path, voice);
  try { unlinkSync(path); } catch {}
  return result;
}

/** Bot username from getMe, needed to unwrap `/cmd@bot` in groups. */
let botUsername = '';

/**
 * Normalized command name (`/new`), or '' for ordinary text.
 * In groups Telegram delivers `/new@deepifiya_bot`, which must still count.
 *
 * The pattern deliberately allows `-` and `.`: `/app-restart-confirm` and
 * `/app.restart.confirm` are what people actually type when they recall a
 * multi-word command, and returning '' for them silently ran a whole AI turn
 * instead (a real miss on 2026-10-20). Punctuation is dropped from the name.
 */
function commandOf(text) {
  const match = /^\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_]+))?$/.exec(text);
  if (match === null) return '';
  if (match[2] && botUsername && match[2].toLowerCase() !== botUsername.toLowerCase()) return '';
  return `/${match[1].toLowerCase().replace(/[.-]+/g, '')}`;
}

/** Canonical immediate command name for a message, or '' when it must queue. */
function immediateCommandOf(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('/')) return '';
  const [head, ...rest] = trimmed.split(/\s+/);
  const collapsed = commandOf(head).replace(/^\//, '');
  return immediateKind(collapsed, rest);
}

/**
 * Turn model markdown into plain readable text.
 *
 * The bridge sends without `parse_mode`, so every `**bold**`, `### heading` and
 * `` `code` `` reached the person as literal punctuation — the chat looked
 * "filled with junk". Telegram formatting is opt-in per message and a bad
 * entity rejects the whole send, so the safe direction is to strip the markers
 * and keep the words.
 */
export function toPlainText(input) {
  let text = String(input ?? '');
  // Fenced code blocks: keep the body, drop the fence and language tag.
  text = text.replace(/```[a-zA-Z0-9]*\n?/g, '').replace(/```/g, '');
  // Inline code and bold/italic/strike markers.
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  // Headings: "### Title" -> "Title".
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // Links: [label](url) -> label (url); bare <url> stays as is.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  // Blockquote markers at line start.
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  // Bullets keep a dash, but "  - x" indentation is dropped to one level.
  text = text.replace(/^\s*[-*+]\s+/gm, '— ');
  // Tables: drop the separator row first (it is pure punctuation), then turn
  // the remaining rows into one line each with " · " between cells. The
  // separator pattern uses [ \t] rather than \s so it cannot eat the newline
  // and glue neighbouring rows together.
  text = text.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_match, row) => row.split('|').map((cell) => cell.trim()).filter((cell) => cell !== '').join(' · '));
  // Collapse the blank runs the removals leave behind.
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** Escape the four characters Telegram's HTML parser treats as markup. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Inline markdown inside one non-code segment -> Telegram HTML. */
function inlineHtml(segment) {
  let text = escapeHtml(segment);
  // Inline code first: its body must not be touched by the emphasis rules.
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
  text = text.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
  text = text.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  // Headings become bold lines.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+)$/gm, '<b>$1</b>');
  // Links: [label](url) -> label (url), both already escaped.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  // Blockquote markers.
  text = text.replace(/^[ \t]{0,3}&gt;[ \t]?/gm, '');
  // Bullets.
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '— ');
  // Tables: drop the separator row, then join cells with a middle dot.
  text = text.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row) => row.split('|').map((cell) => cell.trim()).filter(Boolean).join(' · '));
  return text;
}

/**
 * Markdown -> Telegram HTML with real <pre><code> blocks.
 *
 * A fenced block is what gives the person a tap-to-copy button in Telegram,
 * which is the whole point for shell commands. Everything else stays plain so
 * a malformed entity cannot reject the message: `send` falls back to stripped
 * text when Telegram refuses to parse.
 */
export function toTelegramHtml(input) {
  const source = String(input ?? '');
  const parts = source.split(/```/);
  let out = '';
  parts.forEach((segment, index) => {
    if (index % 2 === 1) {
      // Odd indexes are fenced code. The first line may be a language tag.
      const newline = segment.indexOf('\n');
      const firstLine = newline === -1 ? '' : segment.slice(0, newline).trim();
      const isLanguage = /^[a-zA-Z0-9+#.-]{1,20}$/.test(firstLine);
      const body = isLanguage ? segment.slice(newline + 1) : segment;
      const language = isLanguage ? firstLine.toLowerCase() : '';
      const cls = language ? ` class="language-${language}"` : '';
      out += `<pre><code${cls}>${escapeHtml(body.replace(/\n+$/, ''))}</code></pre>`;
    } else {
      out += inlineHtml(segment);
    }
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

async function send(chatId, text, threadId = 0, replyTo = 0) {
  const html = config.plainText === true ? '' : toTelegramHtml(text);
  const parts = html ? chunk(html, 3800) : chunk(toPlainText(text) || '(пусто)');
  let lastId = 0;
  for (const part of parts) {
    const body = { chat_id: chatId, text: part, disable_web_page_preview: true };
    if (html) body.parse_mode = 'HTML';
    // Without message_thread_id every reply lands in the General topic, which is
    // the whole point of carrying the thread through.
    if (threadId > 0) body.message_thread_id = threadId;
    if (replyTo > 0) body.reply_to_message_id = replyTo;
    let res;
    try {
      res = await tg('sendMessage', body);
    } catch (error) {
      // Bad HTML (a stray < or an unsupported tag) must not swallow the reply:
      // resend the same part as plain text.
      if (!html) throw error;
      log(`html send failed (${String(error.message).slice(0, 120)}); resending as plain text`);
      delete body.parse_mode;
      body.text = toPlainText(part) || '(пусто)';
      res = await tg('sendMessage', body);
    }
    log(`sent chat=${chatId}${threadId ? ` topic=${threadId}` : ''} msg=${res.message_id} len=${part.length}${html ? ' html' : ''}`);
    lastId = res.message_id;
  }
  return lastId;
}

/** Remember which topics already got their seed message, so it happens once. */
function topicSeeded(threadId) {
  return Boolean(state.seededTopics?.[String(threadId)]);
}

/**
 * Seed a newly created forum topic with the person's own message and pin it.
 *
 * Telegram creates a topic with only a service message ("Topic created"), so
 * the thread looks empty: a title with nothing under it. Posting the incoming
 * text there (a) removes the blank, (b) gives the chat something to scroll
 * back to, and (c) pins the thread to the top of the topic list, which is the
 * behaviour the owner asked for.
 *
 * Returns the seeded message id, or 0 when nothing was done.
 */
async function ensureTopicSeed(chatId, threadId, text) {
  if (topicSeeded(threadId)) return 0;
  const body = { chat_id: chatId, text: String(text ?? '').slice(0, 4000), message_thread_id: threadId, disable_web_page_preview: true };
  let messageId = 0;
  try {
    const res = await tg('sendMessage', body);
    messageId = res.message_id;
  } catch (error) {
    log(`topic ${threadId} seed failed: ${error.message}`);
    return 0;
  }
  if (config.pinTopicSeed !== false) {
    try {
      await tg('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: false });
    } catch (error) {
      log(`topic ${threadId} pin failed: ${error.message}`);
    }
  }
  state.seededTopics = state.seededTopics ?? {};
  state.seededTopics[String(threadId)] = messageId;
  saveState();
  noteSeed(text, threadId);
  return messageId;
}

/**
 * Write one line about a new topic into the General chat, so the main stream
 * reads as a log of what was started instead of a wall of prompts. The full
 * text lives in the topic itself; this is only the pointer.
 */
async function logTopicToGeneral(chatId, threadId, text, lang = 'ru') {
  if (config.topicLog === false) return;
  const head = String(text ?? '').replace(/\s+/g, ' ').trim();
  const preview = head.length > 90 ? `${head.slice(0, 90)}…` : head;
  try {
    await tg('sendMessage', {
      chat_id: chatId,
      text: t(lang, 'msg.topicLog', { preview }),
      disable_web_page_preview: true,
    });
    log(`topic ${threadId} logged to General`);
  } catch (error) {
    log(`topic ${threadId} General log failed: ${error.message}`);
  }
}

/** Run one DSH headless turn; resolve {sessionId, text, error}. */
function runTurn(task, sessionId, key = '', onEvent = null, extraArgs = [], cwd = '', profile = config.profile) {
  return new Promise((resolve) => {
    const args = ['--expose-internals', CLI_JS, '--profile', profile, '--json', ...extraArgs];
    if (sessionId) args.push('--session-id', sessionId);
    args.push(task);
    const child = spawn(EXE, args, {
      // Per-topic project directory: a topic can be bound to one repository so
      // "work in my-app" stops meaning "cd in every command".
      cwd: cwd && existsSync(cwd) ? cwd : config.cwd,
      env: {
        ...process.env,
        DSH_TG_KEY: key,
        DSH_TG_CHAT: String(key).split(':')[0] || '',
        DSH_TG_THREAD: String(key).split(':')[1] || '0',
        ELECTRON_RUN_AS_NODE: '1',
        // Provider keys the profile cannot resolve on its own. Configured per
        // install (`providerKeys`, see config.example.json); a key listed in
        // `~/.dsh/.credentials.yaml` is passed by its own name.
        ...providerKeys(config),
      },
      windowsHide: true,
    });
    if (key) activeTurns.set(key, child);
    let stdout = '';
    let stderr = '';
    let sid = sessionId || '';
    let finalText = '';
    const timer = config.turnTimeoutMs > 0 ? setTimeout(() => child.kill(), config.turnTimeoutMs) : null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (buf) => {
      stdout += buf;
      // Any byte from the CLI is proof of life: the model may think for minutes
      // before the next structured event, and a silent turn is not a hung one.
      if (onEvent) { try { onEvent({ type: 'activity' }); } catch {} }
      let idx;
      while ((idx = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, idx).trim();
        stdout = stdout.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'session' && ev.sessionId) sid = ev.sessionId;
          if (ev.type === 'final' && typeof ev.text === 'string') finalText = ev.text;
          if (ev.type === 'error') finalText = finalText || `ошибка: ${ev.message || JSON.stringify(ev)}`;
          // Every event is forwarded so the bridge can show live progress; a
          // silent turn used to look identical to a hung one.
          if (onEvent) {
            try {
              onEvent(ev);
            } catch {}
          }
        } catch {}
      }
    });
    child.stderr.on('data', (buf) => {
      stderr += buf;
      if (onEvent) { try { onEvent({ type: 'activity' }); } catch {} }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (key) activeTurns.delete(key);
      // No live process means no agent to steer; a job written now would wait
      // for the next turn instead of the current one.
      if (key) liveSessions.delete(key);
      // Keep the whole diagnostic: the CLI prints the useful phrase
      // ("pending (waiting for service: speechToText)") on the lines AFTER the
      // one-line summary, and trimming early hid the real cause from the chat.
      // A bare "exit 1" with an empty stderr told the person nothing, so fall
      // back to the tail of stdout, where the CLI puts its own error line.
      let error = '';
      if (code !== 0) {
        const errText = stderr.trim();
        const outTail = stdout
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '' && !line.trim().startsWith('{'))
          .join('\n')
          .trim();
        error = errText || outTail.slice(-1200) || `CLI завершился с кодом ${code} без вывода`;
      }
      resolve({ sessionId: sid, text: finalText, error });
    });
  });
}

async function typingLoop(chatId, threadId, stopFlag) {
  while (!stopFlag.done) {
    try {
      const body = { chat_id: chatId, action: 'typing' };
      if (threadId > 0) body.message_thread_id = threadId;
      await tg('sendChatAction', body);
    } catch {}
    await new Promise((r) => setTimeout(r, 4500));
  }
}

/** Kill the CLI child of one turn, if it is still alive. */
function killTurn(key) {
  const child = activeTurns.get(key);
  if (!child) return false;
  try {
    child.kill();
    activeTurns.delete(key);
    log(`killed hung turn for ${key}`);
    return true;
  } catch (error) {
    log(`kill failed for ${key}: ${error.message}`);
    return false;
  }
}

/** Short, human one-liner for a tool call, mirroring what Hermes shows. */
function toolLine(event) {
  const tool = event.tool || 'tool';
  const input = event.input ?? {};
  const pick = input.command ?? input.description ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.url ?? '';
  let text = String(pick).replace(/\s+/g, ' ').trim();
  if (input.command) {
    // A shell command is a wall of text; keep the first statement and its
    // verb, so the line reads "pwsh: git status" instead of the whole script.
    text = text.split(';')[0].trim();
    text = text.replace(/^(pwsh|powershell|cmd|bash)(\.exe)?\s+(-\S+\s+)*/i, '');
    const verb = text.match(/^([A-Za-z0-9_.\-]+(?:\s+[a-z][a-z0-9-]*)?)/);
    if (verb) text = verb[1];
  }
  return text ? `${tool}: ${text.slice(0, 48)}` : tool;
}

/**
 * One editable status message per turn.
 *
 * Hermes shows the working steps; without them a long turn is indistinguishable
 * from a freeze. The message is created once, then rewritten (at most every few
 * seconds — Telegram rate-limits edits) with the latest step and a counter, and
 * finally turned into a short summary. Errors are edited into the same message
 * so the person always sees one continuous trace instead of scattered notes.
 */
async function startProgress(chatId, threadId, lang = 'ru') {
  const started = Date.now();
  const steps = [];
  /** Last reported token usage for this turn, for the cache line. */
  const usage = { inputTokens: 0, cacheReadTokens: 0 };
  let messageId = 0;
  let lastEdit = 0;
  let dirty = false;
  let timer = null;

  // Short "💭" notes the agent appends with `say.mjs --thought`. The progress
  // message shows the last two, so the person sees the decision trail without
  // a second stream of chat messages.
  const thoughtFile = join(THOUGHT_DIR, `${chatId}_${threadId || 0}.jsonl`);
  let thoughts = [];
  try {
    mkdirSync(THOUGHT_DIR, { recursive: true });
    writeFileSync(thoughtFile, '');
  } catch {}
  const thoughtTimer = setInterval(() => {
    let next = [];
    try {
      next = readFileSync(thoughtFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-2)
        .map((line) => {
          try { return String(JSON.parse(line).text || '').slice(0, 140); } catch { return ''; }
        })
        .filter(Boolean);
    } catch {}
    if (next.join('\n') !== thoughts.join('\n')) {
      thoughts = next;
      schedule();
    }
  }, 3000);
  thoughtTimer.unref?.();

  const body = (final = false) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    const head = final
      ? `✅ ${t(lang, 'status.done')} · ${seconds} ${lang === 'en' ? 's' : lang === 'zh' ? '秒' : 'с'}`
      : `⏳ ${t(lang, 'status.working')}… ${seconds} ${lang === 'en' ? 's' : lang === 'zh' ? '秒' : 'с'}`;
    // Three recent steps is enough to see the shape of the work; six lines of
    // shell commands read as noise on a phone.
    const tail = steps.slice(-3).map((line) => `• ${line}`).join('\n');
    const more = steps.length > 3 ? `\n${t(lang, 'status.more', { n: steps.length - 3 })}` : '';
    const mind = thoughts.length ? `\n${thoughts.map((line) => `💭 ${line}`).join('\n')}` : '';
    // The cache line belongs to the outcome, not to every intermediate edit.
    const cache = final && usage.cacheReadTokens
      ? `\n${t(lang, 'status.cacheLine', {
        pct: Math.round((usage.cacheReadTokens / Math.max(1, usage.cacheReadTokens + (usage.inputTokens ?? 0))) * 100),
        k: Math.round(usage.cacheReadTokens / 1000),
      })}`
      : '';
    return (tail ? `${head}${mind}\n${tail}${more}${cache}` : `${head}${mind}${cache}`);
  };

  try {
    const res = await tg('sendMessage', {
      chat_id: chatId,
      text: body(),
      disable_web_page_preview: true,
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    });
    messageId = res.message_id;
  } catch (error) {
    log(`progress message failed: ${error.message}`);
  }

  const edit = async (text, keyboard = undefined) => {
    if (!messageId) return;
    try {
      const payload = {
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: true,
      };
      // `null` means "remove the buttons"; an object replaces them; `undefined`
      // leaves the current keyboard alone (intermediate status edits).
      if (keyboard !== undefined) payload.reply_markup = keyboard ?? { inline_keyboard: [] };
      await tg('editMessageText', payload);
      lastEdit = Date.now();
    } catch (error) {
      // "message is not modified" and rate limits are expected: ignore quietly.
      dirty = false;
    }
  };

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      await edit(body());
    }, 3500);
    timer.unref?.();
  }

  return {
    /** Keep the clock moving during long model thinking: the elapsed time is
     *  proof of life, and a frozen counter is what reads as a hang. */
    heartbeat() {
      dirty = true;
      schedule();
    },
    handle(event) {
      if (event.type === 'tool_call') {
        steps.push(toolLine(event));
        schedule();
        return;
      }
      // Usage rides on the status events; keep the latest numbers so the final
      // line can show the cache hit rate of this very turn.
      if (event.type === 'status' && event.usage) {
        if (Number.isFinite(event.usage.inputTokens)) usage.inputTokens = event.usage.inputTokens;
        if (Number.isFinite(event.usage.cacheReadTokens)) usage.cacheReadTokens = event.usage.cacheReadTokens;
        schedule();
        return;
      }
      if (event.type === 'status' && event.phase === 'step_start') {
        schedule();
        return;
      }
      if (event.type === 'text' && event.text) {
        const first = String(event.text).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (first) {
          steps.push(`текст: ${first}`);
          schedule();
        }
      }
    },
    async finish(result) {
      clearTimeout(timer);
      clearInterval(thoughtTimer);
      if (result?.error) {
        // A failed turn leaves the status message as the error report and swaps
        // «Стоп» for «Повторить»: the person's next move is a retry, not a stop.
        const failedFor = Math.round((Date.now() - started) / 1000);
        const unit = lang === 'en' ? 's' : lang === 'zh' ? '秒' : 'с';
        const text = `⚠️ ${t(lang, 'status.failed')} · ${failedFor} ${unit}\n${String(result.error).slice(0, 1200)}`;
        await edit(text, errorKeyboard(sessionKey(chatId, threadId), lang));
        return true;
      }
      await edit(body(true), null);
      return false;
    },
  };
}

/**
 * Turn a voice note or an audio file into text, echoing the transcript into the
 * chat so the person sees what was understood before the answer lands.
 *
 * Returns '' when nothing was recognised: the failure is already reported in
 * the chat by then, so callers only have to stop.
 */
async function readVoiceIntoText(msg, chatId, threadId, lang) {
  // Status line first, then replace it with the transcript. One message that
  // visibly turns "🎤 Расшифровываю…" into "🎤 <текст>" tells the person the
  // audio is being read and, when it is done, exactly what was understood —
  // before the agent's reply lands.
  let statusId = 0;
  if (config.voice?.echo !== false) {
    try {
      const res = await tg('sendMessage', {
        chat_id: chatId,
        text: t(lang, 'msg.transcribing'),
        disable_web_page_preview: true,
        ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        ...(msg.message_id ? { reply_to_message_id: msg.message_id } : {}),
      });
      statusId = res.message_id;
    } catch (error) {
      log(`voice status failed: ${error.message}`);
    }
  }
  const editOrSend = async (shown, fallback) => {
    if (statusId) {
      await tg('editMessageText', { chat_id: chatId, message_id: statusId, text: shown })
        .catch((err) => log(`voice status edit failed: ${err.message}`));
    } else if (config.voice?.echo !== false) {
      await send(chatId, fallback, threadId, msg.message_id);
    }
  };
  let heard = '';
  let error = '';
  try {
    ({ text: heard, error } = await voiceToText(msg, config.voice));
  } catch (err) {
    const fail = t(lang, 'msg.voiceDownloadFailed', { err: err.message });
    await editOrSend(`⚠️ ${fail}`, fail);
    return '';
  }
  if (!heard) {
    const fail = t(lang, 'msg.voiceNotRecognized', { detail: error ? `: ${error}` : '' });
    await editOrSend(`⚠️ ${fail}`, fail);
    return '';
  }
  log(`voice -> text len=${heard.length}${error ? ` (warn: ${error})` : ''}`);
  const preview = heard.length > 1200 ? `${heard.slice(0, 1200)}…` : heard;
  if (statusId || config.voice?.echo !== false) await editOrSend(`🎤 ${preview}`, `🎤 ${preview}`);
  return heard;
}

/**
 * Photo or file -> the prompt text that hands its path to the turn.
 *
 * Every supported attachment becomes the same kind of text here, so a normal
 * turn and a mid-turn steer describe a file identically. `extraArgs` carries
 * the vision patch a photo turn needs; a steer cannot apply it to a running
 * turn and leaves it empty.
 */
async function mediaPrompt(msg, chatId, threadId, lang, opts = {}) {
  const voiceReady = Boolean(config.voice?.python && config.voice?.script) || Boolean(config.voice?.command);
  const voiceOn = Boolean(config.voice?.enabled) && voiceReady;
  if (msg.voice || msg.audio) {
    if (!voiceOn) return { text: '', extraArgs: [] };
    return { text: await readVoiceIntoText(msg, chatId, threadId, lang), extraArgs: [] };
  }
  // An audio file sent as a document is a voice note with a different wrapper:
  // transcribe it instead of handing over a path nobody can listen to.
  if (msg.document?.mime_type?.startsWith('audio/') && voiceOn) {
    const heard = await readVoiceIntoText({ ...msg, audio: msg.document }, chatId, threadId, lang);
    return { text: heard, extraArgs: [] };
  }
  // Photo handling: the current default route has no image input, so the turn
  // is run with a `--patch` overlay that points it at a vision model. Without
  // the overlay every photo ended in "model does not declare image input".
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const file = await tg('getFile', { file_id: fileId });
    const path = join(DIR, `photo-${Date.now()}.jpg`);
    const bin = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    writeFileSync(path, Buffer.from(await bin.arrayBuffer()));
    const note = (msg.caption || '').trim();
    let text = t(lang, 'prompt.photo', { path })
      + (note ? ` ${t(lang, 'prompt.note', { note })}` : '');
    // A steer cannot apply the vision overlay to a turn that is already
    // running, so the model gets a path and an honest line instead of a
    // silently unreadable image.
    if (opts.steer) text += ` ${t(lang, 'prompt.photoMidTurn')}`;
    let extraArgs = [];
    if (config.vision?.patch && existsSync(config.vision.patch)) {
      extraArgs = ['--patch', config.vision.patch];
      log(`photo turn uses vision patch ${config.vision.patch}`);
    } else {
      log('photo turn without vision patch: the default model cannot read images');
    }
    return { text, extraArgs };
  }
  // Documents (PDF, zip, source, csv), video and video notes: save under
  // inbox/ and hand the path to the turn. Text-like files are also pasted in
  // as content, so a steer can use them without a tool round-trip.
  const doc = msg.document || msg.video || msg.video_note || msg.animation;
  if (doc) {
    const safe = (doc.file_name || `file-${Date.now()}`).replace(/[^\w.\-]+/g, '_');
    const inbox = join(DIR, 'inbox');
    mkdirSync(inbox, { recursive: true });
    const path = join(inbox, `${Date.now()}-${safe}`);
    const file = await tg('getFile', { file_id: doc.file_id });
    const bin = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!bin.ok) throw new Error(`document download failed: ${bin.status}`);
    writeFileSync(path, Buffer.from(await bin.arrayBuffer()));
    const note = (msg.caption || '').trim();
    const type = doc.mime_type || 'unknown';
    const size = doc.file_size || '?';
    const body = msg.document ? inlineText(path, safe) : '';
    let text = body
      ? t(lang, 'prompt.fileText', { path, type, size, body })
      : t(lang, 'prompt.file', { path, type, size });
    if (note) text += ` ${t(lang, 'prompt.note', { note })}`;
    log(`document saved ${path} bytes=${doc.file_size || 0}${body ? ` inline=${body.length}` : ''}`);
    return { text, extraArgs: [] };
  }
  return { text: '', extraArgs: [] };
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const from = msg.from?.id;

  // 1. Never react to our own output: the bot's seeded topic message comes back
  //    through getUpdates as a normal group message and used to start a turn.
  if (msg.from?.is_bot) {
    log(`ignored own/service message from bot ${from} (chat ${chatId})`);
    return;
  }
  // 2. Service messages (topic created, pins, joins) carry no task text.
  if (!msg.text && !msg.caption && !msg.voice && !msg.audio && !msg.photo && !msg.document) {
    log(`ignored service message chat=${chatId} thread=${msg.message_thread_id ?? 0}`);
    return;
  }

  let threadId = threadOf(msg);
  // 3. The General-chat twin of an already-seeded topic: keep the log line,
  //    skip the turn — the topic message already owns this work.
  const twin = threadId === 0 ? topicSeededRecently(msg.text ?? msg.caption ?? '') : 0;
  if (twin > 0) {
    log(`duplicate of topic ${twin} seen in General; answering in the topic instead`);
    threadId = twin;
  }

  // 4. Lobby rule (Hermes' topic mode): the General thread is where topics are
  //    started, not where work runs. A message with no thread id goes to the
  //    most recently active topic instead of forking a root session — that is
  //    exactly how a prompt typed in General used to be answered in General
  //    while its topic stayed empty.
  if (threadId === 0 && config.generalLobby !== false) {
    const recovered = newestBoundTopic(chatId);
    if (recovered > 0) {
      log(`General message recovered into topic ${recovered}`);
      threadId = recovered;
    }
  }
  touchTopic(threadId);

  const key = sessionKey(chatId, threadId);
  // Language for everything this turn shows: topic choice, config, then Telegram.
  const lang = resolveLang(state, key, msg, config);
  const where = `${chatId}${threadId ? ` topic=${threadId}` : ''}`;
  if (!config.allowedUserIds.includes(from) && !config.allowedUserIds.includes(chatId)) {
    log(`ignored message from ${from} (chat ${chatId})`);
    return;
  }
  let text = (msg.text || msg.caption || '').trim();
  // Voice notes, audio files, photos and documents: transcribe or download
  // locally, then treat the resulting text exactly like typed text. The same
  // helper feeds the mid-turn steer path, so an attachment means the same
  // thing whether the turn is idle or already running.
  //
  // A file almost always arrives with a caption, so the presence of text must
  // not be taken as "no attachment": that dropped every captioned document.
  let extraArgs = [];
  const media = msg.voice || msg.audio || msg.photo || msg.document || msg.video || msg.video_note || msg.animation;
  if (media) {
    const built = await mediaPrompt(msg, chatId, threadId, lang);
    if (built.text) text = built.text;
    extraArgs = built.extraArgs;
  }
  if (!text) return;
  log(`in ${where} from=${from} len=${text.length}${msg.is_topic_message ? ' topic-message' : ''}`);

  // A brand-new forum topic starts empty: the title says what the person wants
  // but the thread itself has no message, so scrolling back shows a blank
  // hole. Seed it with the incoming text and pin the seed, which also pins the
  // topic to the top of the list — the owner asked for exactly that.
  //
  // Seeding runs once per topic: a message written inside an existing topic is
  // already visible there, and seeding it again would duplicate the person's
  // own words.
  if (threadId > 0 && msg.is_topic_message && !topicSeeded(threadId)) {
    const seed = await ensureTopicSeed(chatId, threadId, text);
    if (seed) {
      log(`topic ${threadId} seeded with message=${seed}`);
      await logTopicToGeneral(chatId, threadId, text, lang);
    }
  }

  const space = text.indexOf(' ');
  const head = space === -1 ? text : text.slice(0, space);
  const command = commandOf(head);
  const arg = space === -1 ? '' : text.slice(space + 1).trim();

  // `/apprestart.confirm` (no space) is a real way to mistype the service
  // command and used to fall through to a full AI turn. Map the collapsed
  // forms onto the canonical command + argument instead.
  //
  // Heads are matched WITHOUT their punctuation, so `/apprestart.confirm` and
  // `/app-restart-confirm` both arrive here as "apprestartconfirm".
  const collapsed = command.replace(/^\//, '').replace(/[.-]+/g, '');
  const known = new Set(CONTROL_COMMANDS);
  let effective = known.has(collapsed) ? `/${collapsed}` : '';
  let effectiveArg = arg;
  if (collapsed === 'apprestart' || collapsed === 'apprestartconfirm') {
    effective = '/app';
    // The dotted/solid form already says "restart", so confirm is the only
    // missing word: `/apprestart.confirm` must mean `/app restart confirm`.
    effectiveArg = arg || 'restart confirm';
  } else if (collapsed === 'restartconfirm') {
    effective = '/restart';
    effectiveArg = arg || 'confirm';
  }
  if (effective && effective !== command) {
    log(`command alias: ${head} -> ${effective} ${effectiveArg}`);
  }
  if (effectiveArg === 'restartconfirm' || effectiveArg === 'restart.confirm') effectiveArg = 'restart confirm';

  // An unknown slash command must never become an AI turn: it burns money and
  // answers something the person did not ask. Answer with the menu instead.
  if (command && !effective) {
    log(`unknown command ${head} from ${from}`);
    await send(
      chatId,
      `${t(lang, 'msg.unknownCommand', { cmd: head })}

${t(lang, 'help.body')}`,
      threadId,
      msg.message_id
    );
    return;
  }

  if (effective) {
    const handled = await handleControl({
      command: effective,
      lang,
      arg: effectiveArg,
      text,
      chatId,
      threadId,
      key,
      state,
      config,
      activeTurns,
      saveState,
      log,
      send,
      api: tg,
      sendFile: (p, caption = '') => sendFile(chatId, threadId, p, caption),
      seedTopic: ensureTopicSeed,
      profile: profileOf(key),
      prices: (filter) => {
        const route = modelOf(profileOf(key));
        // A provider page is optional: without `pricesUrl` the answer comes from
        // the public models.dev catalog, so no install is tied to one vendor.
        return renderPrices(filter, {
          model: route.model,
          provider: route.provider,
          pageUrl: config.pricesUrl || '',
          lang,
        });
      },
      reply: (out) => send(chatId, out, threadId),
      stopTurn: (k) => {
        const child = activeTurns.get(k);
        if (!child) return false;
        try {
          child.kill();
          activeTurns.delete(k);
          return true;
        } catch {
          return false;
        }
      },
    });
    if (handled) return;
  }

  // Remember this prompt so the «Повторить» button after a failure has
  // something to resend. Bounded: only the latest prompt per topic matters.
  lastPrompt.set(key, msg);

  const stop = { done: false };
  const typing = typingLoop(chatId, threadId, stop);
  const started = Date.now();
  // Capture the session BEFORE the turn starts. A second message for the same
  // topic can overwrite `state.sessions[key]` while this turn is still running
  // (two messages a few seconds apart, or a copy-paste), and the late writer
  // then attached a fresh session id to a conversation that already had one.
  const sessionAtStart = state.sessions[key];
  // Project directory bound to this topic (set with /cd); config.cwd otherwise.
  const cwd = (state.cwd && state.cwd[key]) || config.cwd;

  // Desktop-style goal: the topic's goal and task list travel with every turn,
  // so a fresh session after /new still knows what the project is aiming at.
  const topicGoal = goalOf(state, key);
  if (topicGoal) text = `${renderPromptBlock(topicGoal, key, GOAL_CMD)}\n\n---\n\n${text}`;

  // Working notes: the agent writes a 💭 line at each decision point with
  // `say.mjs --thought`, and the progress message shows the last two. Off means
  // no instruction at all, so nothing is written and nothing is displayed.
  if (reasoningOf(state, config, key)) {
    text = `${t(lang, 'prompt.reasoning', { say: join(DIR, 'say.mjs') })}\n\n---\n\n${text}`;
  }

  // Live progress: one status message per turn, rewritten as the agent works.
  // Without it a long turn and a hung turn looked exactly alike in the chat.
  const progress = await startProgress(chatId, threadId, lang);
  // Turn telemetry for the log: what the agent did, how much it cost, on which
  // model. Without it /logs shows only "in" and "sent" — useless when asking
  // "why did this take 9 minutes".
  const telemetry = { steps: 0, tools: 0, inputTokens: 0, cacheReadTokens: 0, model: modelOf(profileOf(key)).model };
  const onEvent = (event) => {
    try {
      // The id of the session this process actually works in. A new topic has
      // no id until the CLI emits one, and steering needs it before that.
      if (event.type === 'session' && event.sessionId) liveSessions.set(key, event.sessionId);
      progress.handle(event);
      if (event.type === 'tool_call') {
        telemetry.tools += 1;
        telemetry.steps += 1;
        log(`  tool[${telemetry.steps}] ${toolLine(event).slice(0, 140)}`);
      } else if (event.type === 'tool_result') {
        const failed = event.status && event.status !== 'completed';
        log(`  tool[${telemetry.steps}] ${failed ? 'ОШИБКА' : 'ok'} ${String(event.tool || '').slice(0, 40)}`);
      } else if (event.type === 'status' && event.usage) {
        if (Number.isFinite(event.usage.inputTokens)) telemetry.inputTokens = event.usage.inputTokens;
        if (Number.isFinite(event.usage.cacheReadTokens)) telemetry.cacheReadTokens = event.usage.cacheReadTokens;
      }
    } catch {}
  };
  let result = await runTurnLive(text, sessionAtStart, key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), extraArgs, cwd });
  if (result.error && /unknown id|not found|не найдена|was recorded in/i.test(result.error) && sessionAtStart) {
    delete state.sessions[key];
    log(`session dropped for ${where}: recorded in another directory, starting fresh`);
    result = await runTurnLive(text, '', key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), extraArgs, cwd });
  }
  // Provider failover: the headless profile has no failover plugin, so one busy
  // route ("all providers are busy", 503, or a turn that emits nothing at all)
  // used to end as silence. Retry the SAME prompt on the next model in the
  // chain before giving up — the person cares about an answer, not the vendor.
  const chain = Array.isArray(config.fallbackModels) ? config.fallbackModels : [];
  // A dead paid balance is not a "busy provider": it must trigger the free
  // chain as well, otherwise the bridge sits on AUTH 403 and gives up.
  const FALLBACK_TRIGGERS = /RATE_LIMIT|503|all providers|нет активности|EMPTY_RESPONSE|TIMEOUT|overloaded|AUTH|403|insufficient_user_quota|quota|UNKNOWN_MODEL|MISSING_CREDENTIAL/i;
  const QUOTA_LIKE = /insufficient_user_quota|AUTH\b|\b403\b|\b401\b|quota|balance|баланс|payment|billing/i;
  const tried = [];
  for (const entry of chain) {
    if (!result.error || !FALLBACK_TRIGGERS.test(result.error)) break;
    if (!entry.patch || !existsSync(entry.patch)) continue;
    const quotaLike = QUOTA_LIKE.test(result.error);
    // Quota failures never deserve a retry of the same model: the balance is
    // gone, so waiting is pure loss. Anything else gets one retry at most.
    const reason = quotaLike ? 'квота/баланс исчерпаны' : 'модель не ответила';
    tried.push(`${entry.model}: ${String(result.error).slice(0, 120)}`);
    log(`fallback to ${entry.model} for ${where} reason=${quotaLike ? 'quota' : 'transient'} after: ${String(result.error).slice(0, 120)}`);
    telemetry.model = entry.model;
    await send(chatId, `↻ ${reason} — работаю на ${entry.model}${entry.free ? ' (free)' : ''}`, threadId);
    result = await runTurnLive(text, sessionAtStart, key, {
      onEvent,
      onAbort: () => killTurn(key),
      onHeartbeat: () => progress.heartbeat(),
      extraArgs: ['--patch', entry.patch],
      cwd,
    });
    if (!result.error) break;
  }
  // Every model refused: one message naming the causes, not a cascade of errors.
  if (result.error && tried.length > 0 && tried.length >= (Array.isArray(config.fallbackModels) ? config.fallbackModels.length : 0)) {
    log(`all fallbacks exhausted for ${where}: ${tried.length}`);
    result = {
      sessionId: result.sessionId,
      text: '',
      error: `все модели недоступны.\n${tried.map((line) => `• ${line}`).join('\n')}\n\nПроверь баланс или подожди: /doctor покажет состояние.`,
    };
  }
  // A session opened in the desktop UI holds its write handle, so the CLI
  // refuses to adopt it. Retry once, then continue in a fresh session instead
  // of failing the user's message.
  if (result.error && /already owned by an active write handle/i.test(result.error)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    result = await runTurnLive(text, state.sessions[key] ?? sessionAtStart, key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), extraArgs, cwd });
    if (result.error && /already owned by an active write handle/i.test(result.error)) {
      delete state.sessions[key];
      saveState();
      result = await runTurnLive(text, '', key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), extraArgs, cwd });
      if (!result.error) result.text = `(сессия была занята другим окном — продолжил в новой)\n\n${result.text}`;
    }
  }
  stop.done = true;
  await typing;
  // Name the cause once, in a short stable code, so a screenshot of the error is
  // enough to find the fix — and every code has a concrete next step, not "try again".
  if (result.error) result.error = explainFailure(result.error);
  await progress.finish(result);

  // Never move a topic onto a different session once it has one. A retry that
  // fell back to a fresh session (busy write handle, stale id) is reported in
  // the reply, but persisting it would silently fork the conversation and drop
  // the project context the next message depends on.
  if (result.sessionId && !result.error) {
    if (!sessionAtStart) {
      state.sessions[key] = result.sessionId;
      saveState();
    } else if (result.sessionId !== sessionAtStart) {
      log(`kept session ${sessionAtStart} for ${where} (turn ran in ${result.sessionId})`);
      state.sessions[key] = sessionAtStart;
      saveState();
    }
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const cachePct = telemetry.cacheReadTokens
    ? Math.round((telemetry.cacheReadTokens / Math.max(1, telemetry.cacheReadTokens + telemetry.inputTokens)) * 100)
    : 0;
  const summary = `tools=${telemetry.tools} tokens=${telemetry.inputTokens} cache=${cachePct}% model=${telemetry.model} cwd=${cwd}`;
  if (result.error) {
    // The status message already carries the failure (progress.finish turned it
    // into the error report), so only the log gets the detail here — a second
    // ⚠️ message would just duplicate it.
    log(`turn failed ${where} ${seconds}s ${summary} :: ${result.error.slice(0, 400)}`);
    return;
  }
  log(`turn ok ${where} ${seconds}s session=${result.sessionId} ${summary}`);
  await send(chatId, result.text || '(пустой ответ)', threadId);
}

/**
 * Turn a raw CLI/provider error into `CODE` plus one actionable line.
 *
 * Raw text like `AUTH 403 insufficient_user_quota` means nothing to a person on
 * a phone; the code makes the failure greppable and the hint says what to do.
 */
function explainFailure(text) {
  const raw = String(text);
  const cases = [
    [/insufficient_user_quota|insufficient quota|AUTH\b|\b402\b|\bbalance\b|баланс|billing/i,
      'INSUFFICIENT_QUOTA', 'баланс провайдера пуст. Пополни счёт или оставь free-модели: /prices и /models.'],
    [/Conflict: terminated by other getUpdates|\b409\b/i,
      'TG_CONFLICT', 'того же бота опрашивает второй процесс. Останови лишний: /doctor, затем /restart.'],
    [/MISSING_CREDENTIAL|no credentials|not authenticated/i,
      'MISSING_CREDENTIAL', 'в профиле нет ключа провайдера. Добавь его в приложении DSH и повтори.'],
    [/ENOENT|not recognized|не найден.*dsh|dsh\.cmd/i,
      'NO_DSH_CLI', 'CLI DeepSeek Harness не найден. Проверь установку приложения (нужен dsh.exe в Programs).'],
    [/fetch failed|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|network/i,
      'NETWORK', 'сеть до провайдера недоступна. Повтори через минуту; если повторяется — проверь VPN/DNS.'],
    [/EACCES|EPERM|access is denied|отказано в доступе|sandbox|permission denied/i,
      'SANDBOX_DENY', 'DSH запретил доступ к файлу или каталогу. Проверь путь проекта и права на него.'],
    [/UNKNOWN_MODEL|model not found|no such model/i,
      'UNKNOWN_MODEL', 'модель из конфига недоступна. Список рабочих: /models.'],
    [/empty response|EMPTY_RESPONSE|no output|пустой ответ/i,
      'EMPTY_RESPONSE', 'модель ничего не вернула. Повтори или смени модель: /model.'],
  ];
  for (const [re, code, hint] of cases) {
    if (re.test(raw)) return `${raw}\n\n${code}: ${hint}`;
  }
  return `${raw}\n\nTURN_FAILED: повтори запрос; если ошибка та же — /doctor и /logs errors.`;
}

// Per-topic turn queues: one turn at a time inside a topic, different topics run
// in parallel. Bounded, because every turn is a full Electron process.
const queues = new Map();
const waiting = [];
let running = 0;
const MAX_PARALLEL = 3;

function acquire() {
  if (running < MAX_PARALLEL) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

/**
 * Deferred restart: exit only when nothing is in flight.
 *
 * Killing the bridge from inside a turn kills that turn, so a code update used
 * to mean a lost answer. The protocol is: a `restart.pending` marker appears →
 * the bridge finishes the current work, lets the supervisor start a fresh
 * process, and only exits when the queue is empty. Exit code 75 is the signal a
 * supervisor recognises as "please start me again".
 */
function maybeExitForRestart() {
  if (!existsSync(RESTART_MARKER)) return;
  if (running > 0 || queues.size > 0) return;
  log('restart.pending honoured: exiting 75 for the supervisor');
  try { unlinkSync(RESTART_MARKER); } catch {}
  setTimeout(() => process.exit(75), 300).unref?.();
}

/**
 * Queue notices, one per topic. A notice exists only while the person is
 * waiting: the moment the queued turn starts it is deleted, so a long session
 * does not leave a column of "идёт уже 7 мин" messages behind (it did).
 */
const busyNotices = new Map();

async function clearBusyNotice(key) {
  const notice = busyNotices.get(key);
  if (!notice) return;
  busyNotices.delete(key);
  try {
    await tg('deleteMessage', { chat_id: notice.chatId, message_id: notice.messageId });
  } catch (error) {
    log(`busy notice delete failed: ${error.message}`);
  }
}

/**
 * Whether this profile can receive mid-turn steers. The bridge only writes a
 * job when the `steer-inbox` plugin is actually wired into the profile; without
 * it the file would sit unread until it expired, and the message would be lost.
 * In that case the message queues the old way.
 */
let steerReady;
function steerAvailable(profile = config.profile || 'headless') {
  if (steerReady !== undefined && steerReady.profile === profile) return steerReady.ready;
  try {
    const patch = readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
    steerReady = { profile, ready: /steer-inbox/.test(patch) };
  } catch {
    steerReady = { profile, ready: false };
  }
  return steerReady.ready;
}

/**
 * Hand a message to the turn that is already running.
 *
 * The turn is a separate process, so the bridge writes a job the `steer-inbox`
 * plugin picks up and feeds to `agent.steer()` — next-step input. The agent is
 * told (in the job, by the plugin) to send one short line into the chat via
 * say.mjs; the fallback below covers a model that stays silent.
 */
function steerRunningTurn(msg, text, sessionId, thread) {
  const key = sessionKey(msg.chat.id, thread);
  const lang = resolveLang(state, key, msg, config);
  const job = writeSteerJob(STEER_DIR, {
    sessionId,
    text,
    chatId: msg.chat.id,
    threadId: thread,
    lang,
    say: SAY,
  });
  log(`steer ${job.id} -> ${sessionId} (${text.length} chars)`);
  watchSteer(job, msg, text, thread, lang);
  return job;
}

/**
 * Follow one steer job until it is either acknowledged by the model or taken by
 * the plugin.
 *
 * Two failure modes need cover: a model that stays silent (one neutral line
 * after 90 s), and a job that never reached the agent because the turn ended
 * first — that addition must become its own turn instead of expiring unseen in
 * the directory.
 */
function watchSteer(job, msg, text, thread, lang) {
  const key = sessionKey(msg.chat.id, thread);
  const acked = () => existsSync(join(STEER_DIR, 'acks', `${job.id}.json`));
  const consumed = () => existsSync(join(STEER_DIR, 'done', `${job.id}.json`));
  const check = async (attempt) => {
    try {
      if (acked() || consumed()) return;
      if (activeTurns.has(key)) {
        if (attempt === 0) {
          log(`steer ${job.id} unacknowledged after 90s; sending fallback`);
          await send(msg.chat.id, t(lang, 'steer.ackFallback'), thread);
        }
        setTimeout(() => check(attempt + 1), 60_000).unref?.();
        return;
      }
      // The turn is over and the plugin never picked the job up: deliver it as
      // a turn of its own, otherwise the person's addition is silently lost.
      const pending = join(STEER_DIR, `${job.id}.json`);
      if (!existsSync(pending)) return;
      try { unlinkSync(pending); } catch {}
      log(`steer ${job.id} not consumed by the turn; re-queued as a new turn`);
      enqueue(key, () => handleMessage({
        chat: msg.chat,
        from: msg.from,
        message_id: 0,
        message_thread_id: thread || undefined,
        is_topic_message: thread > 0,
        text,
      }));
    } catch (error) {
      log(`steer watch failed for ${job.id}: ${error.message}`);
    }
  };
  setTimeout(() => check(0), 90_000).unref?.();
}

/**
 * Attachment sent while a turn is running: transcribe/download it first, then
 * steer the resulting text into the same turn. Echoing the transcript is the
 * only confirmation the person gets that the audio was understood, so the
 * helper does that before the steer is written.
 */
async function steerMediaMessage(msg, sessionId, key, thread, lang) {
  const built = await mediaPrompt(msg, msg.chat.id, thread, lang, { steer: true });
  if (!built.text) {
    log('steer media produced no text; nothing injected');
    return;
  }
  if (!activeTurns.has(key)) log(`steer media: turn ended during prep, job will re-queue (${key})`);
  steerRunningTurn(msg, built.text, sessionId, thread);
}

function enqueue(key, task, onBusy) {
  const prev = queues.get(key) || Promise.resolve();
  const queued = queues.has(key);
  const run = prev
    .then(() => acquire())
    .then(async () => {
      // The person was told "your message is queued"; that notice has done its
      // job the moment the turn starts and must not linger in the chat.
      await clearBusyNotice(key);
      // Remember when the turn actually started: the queue notice has to say
      // "идёт уже 24 мин", not just "занято" — silence is what reads as a hang.
      turnStartedAt.set(key, Date.now());
      return task();
    })
    .catch((error) => log(`turn queue error ${key}: ${error.message}`))
    .finally(() => {
      turnStartedAt.delete(key);
      clearBusyNotice(key).catch(() => {});
      release();
      if (queues.get(key) === run) queues.delete(key);
      // A deferred restart waits for exactly this moment: the answer is out and
      // the queue is empty.
      maybeExitForRestart();
    });
  // Say "this topic is busy" instead of leaving the person staring at silence:
  // a second message in the same topic waits for the first turn, which can be
  // minutes, and looked exactly like a hang.
  if (queued && typeof onBusy === 'function') {
    try {
      Promise.resolve(onBusy()).catch(() => {});
    } catch {}
  }
  queues.set(key, run);
  return run;
}

// ------------------------------------------------------------------ кнопки UI
//
// One place decides what each button means. The callback payload is short
// (`stop`, `retry`, `ap:a:1`) because Telegram caps it at 64 bytes; the context
// a press needs (which turn, which approval) lives in `uiState` below.

/** Last prompt per session key, so «Повторить» can resend it. */
const lastPrompt = new Map();

/** Pending approval requests: id -> { key, chatId, threadId, resolve, timer. */
const approvals = new Map();
let approvalSeq = 0;

function errorKeyboard(key, lang = 'ru') {
  return {
    inline_keyboard: [
      [
        { text: `🔁 ${t(lang, 'btn.retry')}`, callback_data: 'retry' },
        { text: `🩺 ${t(lang, 'btn.doctor')}`, callback_data: 'doctor' },
      ],
    ],
  };
}

function approvalKeyboard(requestId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Разрешить', callback_data: `ap:y:${requestId}` },
        { text: '⛔ Запретить', callback_data: `ap:n:${requestId}` },
      ],
      [{ text: '♾ Всегда', callback_data: `ap:a:${requestId}` }],
    ],
  };
}

/**
 * Ask the person to confirm one action.
 *
 * The turn waits here until a button is pressed or the timeout fires, so a
 * prompt must never be left unanswered: an unanswered approval would hang the
 * queue forever.
 */
function requestApproval(chatId, threadId, key, prompt) {
  const id = String(++approvalSeq);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!approvals.has(id)) return;
      approvals.delete(id);
      resolve({ allowed: false, remember: false, expired: true });
    }, Number(config.approvalTimeoutMs ?? 600000));
    timer.unref?.();
    approvals.set(id, { chatId, threadId, key, resolve, timer, prompt });
    void tg('sendMessage', {
      chat_id: chatId,
      text: `❓ Требуется подтверждение\n${prompt}`,
      reply_markup: approvalKeyboard(id),
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch((error) => {
      log(`approval prompt failed: ${error.message}`);
      clearTimeout(timer);
      approvals.delete(id);
      resolve({ allowed: false, remember: false, expired: true });
    });
  });
}

/** Answer a button press: acknowledge, act, and describe the outcome. */
async function handleCallback(query) {
  const data = String(query.data || '');
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const threadId = query.message?.message_thread_id ?? 0;
  const key = sessionKey(chatId, threadId);
  const answer = (text, show = false) =>
    tg('answerCallbackQuery', { callback_query_id: query.id, text, show_alert: show }).catch(() => {});

  // Trim the buttons of the pressed message first: a button that already did
  // its job must not be pressable a second time.
  const clearKeyboard = () =>
    tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});

  if (data === 'stop') {
    const killed = killTurn(key);
    await clearKeyboard();
    await answer(killed ? 'Останавливаю' : 'Уже нечего останавливать');
    log(`stop via button for ${key}: ${killed ? 'killed' : 'nothing'}`);
    if (killed) await send(chatId, '⏹ Ход остановлен.', threadId);
    return;
  }

  if (data === 'logs') {
    await answer('Показываю последние строки');
    try {
      const lines = readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean).slice(-12);
      await send(chatId, lines.join('\n') || '(лог пуст)', threadId);
    } catch (error) {
      await send(chatId, `Не могу прочитать лог: ${error.message}`, threadId);
    }
    return;
  }

  if (data === 'doctor') {
    await answer('Проверяю');
    await send(chatId, 'Напиши /doctor — он соберёт полный отчёт.', threadId);
    return;
  }

  if (data === 'retry') {
    const original = lastPrompt.get(key);
    if (!original) {
      await answer('Нечего повторять');
      await clearKeyboard();
      return;
    }
    await clearKeyboard();
    await answer('Повторяю');
    log(`retry via button for ${key}`);
    enqueue(key, () => handleMessage({ ...original, message_id: original.message_id }));
    return;
  }

  if (data.startsWith('ap:')) {
    const [, verdict, requestId] = data.split(':');
    const pending = approvals.get(requestId);
    if (!pending) {
      await answer('Запрос уже неактуален');
      await clearKeyboard();
      return;
    }
    clearTimeout(pending.timer);
    approvals.delete(requestId);
    await clearKeyboard();
    const allowed = verdict === 'y' || verdict === 'a';
    const remember = verdict === 'a';
    pending.resolve({ allowed, remember, expired: false });
    await answer(allowed ? (remember ? 'Разрешено всегда' : 'Разрешено') : 'Запрещено');
    log(`approval ${verdict} for request ${requestId}`);
    return;
  }

  await answer('Неизвестная кнопка');
}

/**
 * Turn runner with an IDLE deadline and a live progress sink.
 *
 * A fixed wall-clock limit is wrong for this work: a real build or a long
 * research pass legitimately outlives any short cap, and killing it at 7
 * minutes threw away finished work (the 422s failure on 2026-10-21). What
 * actually matters is SILENCE — a turn that emits no event for N seconds is
 * stuck. Every CLI event therefore refreshes the deadline.
 *
 * Returns {sessionId, text, error}: the error carrying "no activity" when the
 * idle window expires.
 */
function runTurnLive(task, sessionId, key, options = {}) {
  const idleMs = Number(options.idleMs ?? config.turnIdleMs ?? 300000);
  // A tool can legitimately run for many minutes (install, build, test suite)
  // while the model emits nothing at all. Silence during a tool call is work,
  // not a hang, so it gets its own much longer window.
  const toolIdleMs = Number(options.toolIdleMs ?? config.turnToolIdleMs ?? 30 * 60 * 1000);
  const hardMs = Number(options.hardMs ?? config.turnTimeoutMs ?? 1800000);
  const onEvent = options.onEvent;

  return new Promise((resolve) => {
    let done = false;
    let idleTimer;
    let lastType = '';
    let sessionSeen = sessionId || '';

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      resolve(value);
    };

    const armIdle = (windowMs = idleMs) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Silence is NOT a hang: the model can think for many minutes, and a
        // long task may take hours. Keep the turn alive, refresh the visible
        // clock so the person sees progress, and re-arm.
        log(`turn quiet ${Math.round(windowMs / 1000)}s for ${key}; heartbeat`);
        if (options.onHeartbeat) { try { options.onHeartbeat(); } catch {} }
        armIdle(windowMs);
      }, windowMs);
    };

    // Generous absolute ceiling: protects the queue from a turn that keeps
    // emitting trivia forever, without punishing real long work.
    // Optional absolute ceiling. 0 (the default now) means "no cap": a real
    // task may take hours, and the turn ends when the CLI exits or the person
    // presses Стоп — not when a timer decides.
    const hardTimer = hardMs > 0 ? setTimeout(() => {
      log(`turn hard cap ${Math.round(hardMs / 60000)}min for ${key}; aborting`);
      finish({
        sessionId: sessionSeen,
        text: '',
        error: `ход превысил ${Math.round(hardMs / 60000)} мин и был прерван.`,
      });
      if (options.onAbort) options.onAbort();
    }, hardMs) : null;

    armIdle();

    runTurn(task, sessionId, key, (event) => {
      if (event.type === 'activity') {
        armIdle(lastType === 'tool_call' ? toolIdleMs : idleMs);
        return;
      }
      lastType = event.type;
      armIdle(event.type === 'tool_call' ? toolIdleMs : idleMs);
      if (event.type === 'session' && event.sessionId) sessionSeen = event.sessionId;
      if (onEvent) {
        try {
          onEvent(event);
        } catch {}
      }
    }, options.extraArgs ?? [], options.cwd ?? '', profileOf(key))
      .then((result) => finish({ ...result, sessionId: result.sessionId || sessionSeen }))
      .catch((error) => finish({ sessionId: sessionSeen, text: '', error: String(error?.message ?? error) }));
  });
}

async function main() {
  log('bridge started');
  try {
    const me = await tg('getMe');
    botUsername = me.username || '';
    log(`bot @${me.username}`);
    // Confirm the restart in the topic it was asked from, not in the DM: the
    // person who typed `/restart confirm` was looking at that thread.
    try {
      if (existsSync(RESTART_NOTICE)) {
        const notice = JSON.parse(readFileSync(RESTART_NOTICE, 'utf8'));
        unlinkSync(RESTART_NOTICE);
        if (Date.now() - Number(notice.at || 0) < 10 * 60 * 1000) {
          const lang = resolveLang(state, sessionKey(notice.chatId, notice.threadId || 0), null, config);
          await send(
            notice.chatId,
            `✅ ${t(lang, 'msg.restarted', { pid: process.pid })}`,
            notice.threadId || 0,
          );
        }
      }
    } catch (error) {
      log(`restart notice failed: ${error.message}`);
    }
    for (const id of config.allowedUserIds) {
      try { await send(id, `🤖 ${t(config.lang || 'ru', 'msg.started')}`); } catch {}
    }
  } catch (error) {
    log(`startup notice failed: ${error.message}`);
  }

  /** One update: journal first, then the turn, then ack after delivery. */
  const accept = (update, replay = false) => {
    const msg = update.message;
    if (!msg) {
      ack(update.update_id);
      return;
    }
    const queueKey = sessionKey(msg.chat.id, threadOf(msg));
    const thread = threadOf(msg);
    // `/stop` behind the turn it should kill is a no-op; run the few commands
    // that only read or kill state outside the per-topic queue.
    const immediate = immediateCommandOf(msg.text ?? '');
    if (immediate) {
      log(`command ${immediate} handled outside the queue`);
      Promise.resolve()
        .then(() => handleMessage(msg))
        .then(() => ack(update.update_id))
        .catch((error) => log(`command ${immediate} failed: ${error.message}`));
      return;
    }
    // A plain message during a running turn is an addition to that work, not a
    // new turn: steer it into the live agent instead of queueing it behind the
    // very turn it is meant to change. Voice notes, photos and files count as
    // additions too — they are converted to text first, exactly as an idle
    // turn would convert them.
    const steerText = (msg.text || '').trim();
    // A caption rides along with the file; it must not turn the attachment into
    // a text-only steer, or the file itself is silently dropped.
    const steerMedia = Boolean(msg.voice || msg.audio || msg.photo || msg.document || msg.video || msg.video_note || msg.animation);
    if ((steerText || steerMedia) && !steerText.startsWith('/') && config.steerDuringTurn !== false && steerAvailable(profileOf(key))) {
      const sessionId = liveSessions.get(queueKey) || state.sessions[queueKey];
      if (activeTurns.has(queueKey) && sessionId) {
        if (steerText && !steerMedia) {
          try {
            const job = steerRunningTurn(msg, steerText, sessionId, thread);
            log(`steer handled outside the queue: ${job.id}`);
            ack(update.update_id);
          } catch (error) {
            log(`steer write failed: ${error.message}`);
          }
          return;
        }
        // Transcription and downloads take seconds; the update loop must not
        // wait for them, and the turn may even finish meanwhile — the steer
        // watcher then turns the prepared text into a turn of its own.
        ack(update.update_id);
        const lang = resolveLang(state, queueKey, msg, config);
        void steerMediaMessage(msg, sessionId, queueKey, thread, lang).catch((error) => {
          // The attachment could not be prepared (download, transcription). It
          // still deserves an answer, so let the normal path take it: it retries
          // the same work and reports the failure itself.
          log(`steer media failed, queueing a normal turn: ${error.message}`);
          enqueue(queueKey, () => handleMessage(msg));
        });
        return;
      }
    }
    enqueue(
      queueKey,
      async () => {
        try {
          await handleMessage(msg);
          // handleMessage returns only after the reply reached Telegram (or the
          // turn failed loudly), so this is the correct moment to forget it.
          ack(update.update_id);
          if (replay) log(`replayed update ${update.update_id} after restart`);
        } catch (error) {
          // Keep the pending file: the next start retries it once.
          log(`turn error for update ${update.update_id}: ${error.message}`);
        }
      },
      // Only plain text prompts can queue behind a turn; commands are
      // handled inline and must stay silent about it.
      msg.text || msg.caption
        ? async () => {
            // Which turn was running when this message was queued: if that
            // value changes, the queued turn has started and the notice is
            // already obsolete.
            const turnWhenQueued = turnStartedAt.get(queueKey);
            await new Promise((resolve) => setTimeout(resolve, Number(config.busyNoticeMs ?? 45000)));
            if (!queues.has(queueKey)) return; // already finished
            // One notice per topic: a second queued message must not add a
            // second copy of the same line.
            if (busyNotices.has(queueKey)) return;
            const started = turnStartedAt.get(queueKey);
            const mins = started ? Math.max(1, Math.round((Date.now() - started) / 60000)) : 0;
            const notice = mins > 0
              ? t(lang, 'msg.busy.since', { min: mins })
              : t(lang, 'msg.busy.now');
            const messageId = await send(
              msg.chat.id,
              `⏳ ${notice}`,
              thread,
            );
            if (messageId) busyNotices.set(queueKey, { chatId: msg.chat.id, messageId });
            // The queued turn may have started while the notice was in flight;
            // in that case nothing else will delete it until the turn ends.
            if (noticeIsObsolete(turnWhenQueued, turnStartedAt.get(queueKey), queues.has(queueKey))) {
              await clearBusyNotice(queueKey);
            }
          }
        : undefined,
    );
  };

  // Replay anything the previous process owed an answer. Runs before polling so
  // a crash mid-turn costs one duplicate-free retry, not a lost message.
  const owed = pendingUpdates();
  if (owed.length > 0) {
    log(`replaying ${owed.length} pending update(s) from the journal`);
    for (const { update } of owed) accept(update, true);
  }

  let pollFailures = 0;
  for (;;) {
    try {
      // `callback_query` is required for inline buttons: without it Telegram
      // never delivers button presses, so «Стоп» would draw but do nothing.
      const updates = await tg('getUpdates', { offset: state.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 120000);
      if (pollFailures > 0) { log(`poll recovered after ${pollFailures} failure(s)`); pollFailures = 0; }
      for (const update of updates) {
        if (update.callback_query) {
          // Buttons are handled inline and immediately: they are neither
          // journaled nor queued, because a stale button must answer at once.
          state.offset = Math.max(state.offset, update.update_id + 1);
          saveState();
          try {
            await handleCallback(update.callback_query);
          } catch (error) {
            log(`callback error: ${error.message}`);
          }
          continue;
        }
        // Journal BEFORE the offset moves: the reverse order is what silently
        // ate messages whenever the process died mid-turn.
        writePending(update);
        state.offset = Math.max(state.offset, update.update_id + 1);
        saveState();
        accept(update);
      }
    } catch (error) {
      const msg = String(error?.message ?? error);
      const code = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(msg)
        ? 'TG_NET'
        : 'TG_POLL';
      pollFailures += 1;
      const waitMs = Math.min(30000, 5000 * 2 ** Math.min(pollFailures - 1, 3));
      log(`poll error [${code}]: ${msg} — retry in ${Math.round(waitMs / 1000)}s`
        + (code === 'TG_NET' ? ' (hint: check IPv4 route / VPN)' : ''));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

main();
