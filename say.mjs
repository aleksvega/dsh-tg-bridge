#!/usr/bin/env node
// say.mjs — one short line from the agent into the Telegram chat, mid-turn.
//
// The agent calls this right after it picks up a mid-turn addition, so the
// person sees "принял, делаю X, добавку поставлю после Y" while the turn is
// still running instead of silence until the end.
//
//   node say.mjs --steer <job-id> "text"
//   node say.mjs --chat <chat-id> [--thread <id>] "text"
//   node say.mjs --thought "short note"   (no ids needed)
//   node say.mjs --note "short sentence"  (a real chat message, no ids needed)
//
// `--thought` is a note inside the progress message. `--note` is a real chat
// message: use it for what the person must know now (a release shipped, a cause
// found, a blocker), not for every step.
//
// `--thought` does not send a message: it appends to the turn's thought file,
// and the live progress message shows the last two notes as 💭 lines.
//
// With `--steer` the chat/thread come from the job file and an ack marker is
// written, which suppresses the bridge's fallback line.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const STEER = join(DSH_HOME, 'tg-bridge', 'steer');
const ACKS = join(STEER, 'acks');
const THOUGHTS = join(DSH_HOME, 'tg-bridge', 'thoughts');

function findToken() {
  const env = (process.env.DSH_TELEGRAM_BOT_TOKEN || '').trim();
  if (env) return env;
  try {
    const text = readFileSync(join(DSH_HOME, '.credentials.yaml'), 'utf8');
    const m = text.match(/^\s*(DSH_TELEGRAM_BOT_TOKEN[A-Z0-9_]*):\s*["']?([^"'\s]+)/m);
    if (m) return m[2];
  } catch {}
  return '';
}

function jobOf(id) {
  for (const path of [join(STEER, 'done', `${id}.json`), join(STEER, `${id}.json`)]) {
    try {
      if (existsSync(path)) return { path, job: JSON.parse(readFileSync(path, 'utf8')) };
    } catch {}
  }
  return null;
}

function usage() {
  console.error('usage: node say.mjs --steer <id> "text" | --chat <id> [--thread <id>] "text" | --thought "text" | --note "text"');
  process.exit(2);
}

function parse(argv) {
  const out = { chatId: 0, threadId: 0, steer: '', thought: false, text: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--steer') out.steer = argv[++i] || '';
    else if (arg === '--chat') out.chatId = Number(argv[++i] || 0);
    else if (arg === '--thread') out.threadId = Number(argv[++i] || 0);
    else if (arg === '--thought') out.thought = true;
    else if (arg === '--note') out.note = true;
    else rest.push(arg);
  }
  out.text = rest.join(' ').trim();
  return out;
}

function activeThoughtFile() {
  // The bridge hands every turn a file of its own (DSH_TG_THOUGHT) and exports
  // that path to the tools it runs. Guessing from the newest file sent one
  // turn's lines into another topic: two turns running at once each rewrite
  // their own file every few seconds, so "newest" is a coin toss and the loser
  // posts its notes into a stranger's chat. Only the explicit path is safe.
  const explicit = (process.env.DSH_TG_THOUGHT || '').trim();
  if (!explicit) return null;
  const base = explicit.replace(/\.jsonl$/, '').split(/[\\/]/).pop() || '';
  const cut = base.indexOf('_');
  if (cut <= 0) return null;
  const chatId = Number(base.slice(0, cut));
  if (!chatId) return null;
  return { chatId, threadId: Number(base.slice(cut + 1)) || 0 };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!args.text) usage();

  // Without a target, the safest answer is silence: refusal with the reason is
  // better than a note in the wrong topic.
  if (!args.steer && !args.chatId && !Number(process.env.DSH_TG_CHAT || 0) && !activeThoughtFile()) {
    console.error('no target: pass --steer/--chat, or run inside a turn whose DSH_TG_THOUGHT is set');
    process.exit(7);
  }

  let chatId = args.chatId || Number(process.env.DSH_TG_CHAT || 0);
  let threadId = args.threadId || Number(process.env.DSH_TG_THREAD || 0);
  let jobPath = '';
  // Tool shells do not inherit the bridge's env, so fall back to the thought
  // file the bridge named for this very turn.
  if (!chatId && (args.thought || args.note)) {
    const active = activeThoughtFile();
    if (active) {
      chatId = active.chatId;
      threadId = active.threadId;
    }
  }
  if (args.steer) {
    const found = jobOf(args.steer);
    if (!found) {
      console.error(`steer job ${args.steer} not found — the turn may have ended`);
      process.exit(3);
    }
    chatId = Number(found.job.chatId || 0);
    threadId = Number(found.job.threadId || 0);
    jobPath = found.path;
  }
  if (!chatId) usage();

  if (args.thought) {
    try {
      mkdirSync(THOUGHTS, { recursive: true });
      const file = join(THOUGHTS, `${chatId}_${threadId || 0}.jsonl`);
      appendFileSync(file, `${JSON.stringify({ at: Date.now(), text: args.text })}\n`, 'utf8');
      console.log(file);
    } catch (error) {
      console.error(String(error?.message ?? error));
      process.exit(6);
    }
    return;
  }

  const token = findToken();
  if (!token) {
    console.error('bot token not found (DSH_TELEGRAM_BOT_TOKEN or ~/.dsh/.credentials.yaml)');
    process.exit(5);
  }

  const body = { chat_id: chatId, text: args.text, disable_web_page_preview: true };
  if (threadId > 0) body.message_thread_id = threadId;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error(`telegram: ${data.description || res.status}`);
    process.exit(4);
  }
  if (args.steer) {
    try {
      mkdirSync(ACKS, { recursive: true });
      writeFileSync(join(ACKS, `${args.steer}.json`), JSON.stringify({ at: Date.now(), messageId: data.result.message_id, job: jobPath }), 'utf8');
    } catch {}
  }
  console.log(`sent ${data.result.message_id}`);
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
