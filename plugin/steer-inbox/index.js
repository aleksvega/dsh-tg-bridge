// dsh-steer-inbox — file-based mid-turn steering for DSH.
//
// A turn is one process, so an outside caller (the Telegram bridge) cannot
// reach the running agent's inbox directly. This plugin runs inside that
// process, watches a directory, and hands each file to the live agent's
// `steer()` — next-step input, not a queued next turn — which is what makes
// "добавь ещё вот это" land inside the current work instead of after it.
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cordis plugin name (loader row id is `steer-inbox`). */
const name = 'steer-inbox';
/** `ctx.agents` is the live-agent registry this plugin steers. */
const inject = ['agents'];

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh');
const DEFAULT_DIR = join(DSH_HOME, 'tg-bridge', 'steer');
const LOG_DIR = join(DSH_HOME, 'storages', 'steer-inbox');

function log(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, 'steer.ndjson'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

function apply(ctx, config = {}) {
  const dir = config.dir || DEFAULT_DIR;
  const doneDir = join(dir, 'done');
  try {
    mkdirSync(dir, { recursive: true });
    mkdirSync(doneDir, { recursive: true });
  } catch {}

  const tick = () => {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const file of files) {
      const full = join(dir, file);
      let job;
      try {
        job = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        continue; // half-written; the writer renames into place atomically
      }
      // A job written for a turn that already ended will never match a live
      // agent again; without this it would sit in the directory forever and
      // could steer a much later session that reuses the id.
      try {
        if (Date.now() - statSync(full).mtimeMs > 10 * 60 * 1000) {
          unlinkSync(full);
          log(`expired ${file}`);
          continue;
        }
      } catch {}
      const handle = job.sessionId ? ctx.agents.get(job.sessionId) : undefined;
      if (!handle) continue; // not this process; leave it for the right one
      // `get()` has returned the Agent itself in practice and an AgentHandle in
      // the docs; accept either instead of betting on one shape.
      const agent = typeof handle.steer === 'function' ? handle : handle.agent;
      if (typeof agent?.steer !== 'function') {
        log(`no steer() on the live agent for ${job.sessionId}`);
        continue;
      }
      try {
        // The addition lands inside the current work. The agent is also told to
        // send one short line into the chat right away — otherwise the person
        // sees nothing until the very end of a long turn and assumes the
        // addition was lost.
        const sayPath = job.say || join(DSH_HOME, 'tg-bridge', 'say.mjs');
        const line = [
          '',
          '---',
          '[mid-turn addition from the person in Telegram]',
          'Before your next tool call, send them ONE short line in their own language: what you are doing now and where this addition fits.',
          `Use exactly: node "${sayPath}" --steer ${job.id} "one short line"`,
          'Then continue the work and include this addition. Do not repeat that line in the final answer.',
        ].join('\n');
        agent.steer({
          // DSH stores the steered message verbatim and validates the session
          // log on load: an event whose message has no `id`/`role` makes every
          // later turn fail with "event at seq N lacks an identified message",
          // and the whole topic dies until the log is repaired by hand.
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: `${String(job.text ?? '')}${line}` }],
          source: { kind: 'tg-bridge' },
        });
        log(`steered ${job.sessionId} (${String(job.text ?? '').length} chars) id=${job.id}`);
        try {
          const target = join(doneDir, file);
          try { unlinkSync(target); } catch {}
          renameSync(full, target);
        } catch {}
      } catch (error) {
        log(`steer failed for ${job.sessionId}: ${error?.message ?? error}`);
        // A malformed job must not be retried forever.
        try { renameSync(full, `${full}.failed`); } catch {}
      }
    }
  };

  ctx.effect(() => {
    const timer = setInterval(tick, 500);
    timer.unref?.();
    log(`watching ${dir} (pid ${process.pid})`);
    return () => clearInterval(timer);
  }, 'steer-inbox.watch');
}

export { name, inject, apply };
