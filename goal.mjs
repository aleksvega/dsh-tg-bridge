#!/usr/bin/env node
// Agent-facing helper for the topic goal list.
//
// The bridge owns state.json; this script only writes a job file that the
// bridge drains on its next tick. That keeps one writer and no lock dance.
//
//   node goal.mjs --key <chat:thread> --status
//   node goal.mjs --key <chat:thread> --add "write tests"
//   node goal.mjs --key <chat:thread> --done 2
//   node goal.mjs --key <chat:thread> --remove 2
//   node goal.mjs --key <chat:thread> --set "new goal"
//   node goal.mjs --key <chat:thread> --finish
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// State lives where the bridge keeps it, even when this script is executed
// from the profile's node_modules (plugin install).
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DIR = process.env.DSH_TG_HOME || join(DSH_HOME, 'tg-bridge');
const JOBS = join(DIR, 'goal-jobs');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const key = arg('key');
if (!key) {
  console.error('usage: node goal.mjs --key <chat:thread> [--status|--add TEXT|--done N|--remove N|--set TEXT|--finish]');
  process.exit(2);
}

function readState() {
  try {
    return JSON.parse(readFileSync(join(DIR, 'state.json'), 'utf8'));
  } catch {
    return {};
  }
}

function show() {
  const goal = readState().goals?.[key];
  if (!goal) {
    console.log('no goal for this topic');
    return;
  }
  console.log(goal.done ? `[closed] ${goal.text}` : goal.text);
  goal.tasks.forEach((t, i) => console.log(`${i + 1}. [${t.done ? 'x' : ' '}] ${t.text}`));
  const done = goal.tasks.filter((t) => t.done).length;
  console.log(`progress: ${done}/${goal.tasks.length}`);
}

if (process.argv.includes('--status')) {
  show();
  process.exit(0);
}

let op;
if (process.argv.includes('--finish')) op = 'finish';
else if (process.argv.includes('--clear')) op = 'clear';
else if (process.argv.includes('--set')) op = 'set';
else if (process.argv.includes('--add')) op = 'add';
else if (process.argv.includes('--done')) op = 'done';
else if (process.argv.includes('--remove')) op = 'remove';

if (!op) {
  console.error('nothing to do: pass --status, --set, --add, --done, --remove, --finish or --clear');
  process.exit(2);
}

const job = { key, op, at: Date.now() };
if (op === 'set') job.text = arg('set');
if (op === 'add') job.text = arg('add');
if (op === 'done') job.index = Number(arg('done'));
if (op === 'remove') job.index = Number(arg('remove'));

mkdirSync(JOBS, { recursive: true });
const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 7)}.json`;
const tmp = join(JOBS, `${name}.tmp`);
writeFileSync(tmp, JSON.stringify(job), 'utf8');
renameSync(tmp, join(JOBS, name));
console.log(`${op} queued`);
