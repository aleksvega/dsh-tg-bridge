// `/agentset` typed as a job file, for the turn that is already running.
//
// The bridge is the only writer of `state.json`, so a running turn cannot bind
// a set by itself. It drops a job instead (say.mjs --aset), and the bridge's
// drain loop applies it — exactly like `goal.mjs` and the steer queue. Reading
// jobs from a directory keeps the settings command working during a turn
// instead of failing with "busy".
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Where the bridge looks; the agent's `--aset` writes here. */
export const asetJobDir = (dir) => join(dir, 'aset-jobs');

/**
 * Apply every pending job once. `apply(job)` returns `{ok, text}`; a job that
 * cannot be parsed is dropped with its error rather than retried forever,
 * because a half-newer job file is not written by anything.
 * Returns the applied results, so the caller can answer in the topic.
 */
export function drainAsetJobs(dir, apply, doneDir = join(asetJobDir(dir), 'done')) {
  const source = asetJobDir(dir);
  let files = [];
  try {
    files = readdirSync(source).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const results = [];
  // A refused or broken job still has to leave the queue: `done/` keeps it for
  // the log, and a missing directory is created rather than failing the drain.
  mkdirSync(doneDir, { recursive: true });
  for (const name of files) {
    const path = join(source, name);
    let job;
    try {
      job = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      unlinkSync(path);
      continue;
    }
    let result;
    try {
      result = apply(job) ?? { ok: false, text: 'not applied' };
    } catch (error) {
      result = { ok: false, text: String(error?.message || error) };
    }
    // A refused job changed nothing, so there is nothing to persist.
    result = { ...result, changed: Boolean(result.changed) };
    results.push({ job, ...result });
    try {
      renameSync(path, join(doneDir, name));
    } catch {
      try { unlinkSync(path); } catch { /* the next pass will try again */ }
    }
  }
  return results;
}