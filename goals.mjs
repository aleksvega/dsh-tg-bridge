// Goal + task list for one Telegram topic.
//
// State lives in the bridge's state.json (keyed by `chat:thread`), so it
// survives restarts and is visible to every turn. This module is pure: it
// mutates a plain object and returns data, never sends messages. The bridge
// injects the rendered block into the prompt; the agent updates it through
// `goal.mjs`, which drops a job file the bridge applies.
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_TASKS = 30;
export const MAX_GOAL_CHARS = 500;

export function goalsOf(state) {
  if (!state.goals || typeof state.goals !== 'object') state.goals = {};
  return state.goals;
}

export function goalOf(state, key) {
  return goalsOf(state)[key] || null;
}

/** Set or replace the goal text; keeps the existing task list. */
export function setGoal(state, key, text) {
  const clean = String(text || '').trim().slice(0, MAX_GOAL_CHARS);
  if (!clean) return null;
  const goals = goalsOf(state);
  const now = new Date().toISOString();
  goals[key] = {
    text: clean,
    tasks: goals[key]?.tasks || [],
    done: false,
    createdAt: goals[key]?.createdAt || now,
    updatedAt: now,
  };
  return goals[key];
}

export function clearGoal(state, key) {
  const goals = goalsOf(state);
  if (!goals[key]) return false;
  delete goals[key];
  return true;
}

export function finishGoal(state, key) {
  const goal = goalOf(state, key);
  if (!goal) return null;
  goal.done = true;
  goal.updatedAt = new Date().toISOString();
  goal.tasks = goal.tasks.map((t) => ({ ...t, done: true }));
  return goal;
}

export function addTask(state, key, text) {
  const clean = String(text || '').trim().slice(0, MAX_GOAL_CHARS);
  if (!clean) return null;
  const goal = goalOf(state, key);
  if (!goal) return null;
  if (goal.tasks.length >= MAX_TASKS) return null;
  goal.tasks.push({ text: clean, done: false });
  goal.updatedAt = new Date().toISOString();
  return goal.tasks.length;
}

export function doneTask(state, key, index) {
  const goal = goalOf(state, key);
  const i = Number(index) - 1;
  if (!goal || !Number.isInteger(i) || i < 0 || i >= goal.tasks.length) return false;
  goal.tasks[i].done = true;
  goal.updatedAt = new Date().toISOString();
  return true;
}

export function removeTask(state, key, index) {
  const goal = goalOf(state, key);
  const i = Number(index) - 1;
  if (!goal || !Number.isInteger(i) || i < 0 || i >= goal.tasks.length) return false;
  goal.tasks.splice(i, 1);
  goal.updatedAt = new Date().toISOString();
  return true;
}

export function progressOf(goal) {
  const total = goal?.tasks.length || 0;
  const done = goal?.tasks.filter((t) => t.done).length || 0;
  return { total, done };
}

/** Compact block prepended to the turn prompt. Empty string when no goal. */
export function renderPromptBlock(goal, key, goalCmd) {
  if (!goal) return '';
  const lines = ['[Topic goal — set by the person in Telegram]', goal.done ? `${goal.text} (closed)` : goal.text];
  if (goal.tasks.length > 0) {
    lines.push('[Tasks]');
    goal.tasks.forEach((task, i) => lines.push(`${i + 1}. [${task.done ? 'x' : ' '}] ${task.text}`));
  }
  lines.push(
    '[How to update]',
    `When a task is finished, run: node "${goalCmd}" --key "${key}" done <number>`,
    'Do not repeat this block in your answer; report progress in one or two lines.',
  );
  return lines.join('\n');
}

/** Apply one job written by goal.mjs. Returns a short status string. */
export function applyGoalJob(state, job) {
  if (!job || typeof job.key !== 'string' || !job.key) return 'bad job: no key';
  switch (job.op) {
    case 'set':
      return setGoal(state, job.key, job.text) ? 'goal set' : 'empty goal';
    case 'clear':
      return clearGoal(state, job.key) ? 'goal cleared' : 'no goal';
    case 'finish': {
      const goal = finishGoal(state, job.key);
      return goal ? 'goal closed' : 'no goal';
    }
    case 'add':
      if (!goalOf(state, job.key)) setGoal(state, job.key, 'Tasks');
      return addTask(state, job.key, job.text) ? 'task added' : 'task rejected';
    case 'done':
      return doneTask(state, job.key, job.index) ? 'task done' : 'bad task number';
    case 'remove':
      return removeTask(state, job.key, job.index) ? 'task removed' : 'bad task number';
    default:
      return 'unknown op';
  }
}

/**
 * Drain `dir`: apply every *.json job, move it to done/ or failed/.
 * Returns the number of applied jobs.
 */
export function drainGoalJobs(state, dir, doneDir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return 0;
  }
  if (files.length === 0) return 0;
  mkdirSync(doneDir, { recursive: true });
  let applied = 0;
  for (const file of files) {
    const full = join(dir, file);
    let job;
    try {
      job = JSON.parse(readFileSync(full, 'utf8'));
    } catch {
      // Unparseable: move it out of the inbox instead of retrying forever.
      try {
        renameSync(full, join(doneDir, `failed-${file}`));
      } catch {}
      continue;
    }
    const status = applyGoalJob(state, job);
    const ok = !status.startsWith('bad') && status !== 'no goal' && status !== 'empty goal' && status !== 'task rejected';
    if (ok) applied += 1;
    try {
      renameSync(full, join(doneDir, `${ok ? '' : 'failed-'}${file}`));
    } catch {
      try {
        unlinkSync(full);
      } catch {}
    }
  }
  return applied;
}
