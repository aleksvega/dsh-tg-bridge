// Writing a mid-turn steer job.
//
// The bridge cannot reach the agent's inbox: a turn is a separate process. It
// drops a JSON file into `~/.dsh/tg-bridge/steer/`, the `steer-inbox` plugin
// notices it within 500 ms and calls `agent.steer()` — next-step input, so the
// addition lands in the work already running instead of behind it.
//
// The file is written to a dot-prefixed temp name and renamed into place, so
// the plugin can never read half a job.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export function newSteerId() {
  return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

/**
 * @param {string} dir      steer directory
 * @param {object} job      {sessionId, text, chatId, threadId, lang, say}
 * @returns {object} the written job, including its `id` and `at`
 */
export function writeSteerJob(dir, job) {
  const id = job.id || newSteerId();
  const payload = { ...job, id, at: Date.now() };
  mkdirSync(dir, { recursive: true });
  const final = join(dir, `${id}.json`);
  const tmp = join(dir, `.${id}.tmp`);
  writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  renameSync(tmp, final);
  return payload;
}
