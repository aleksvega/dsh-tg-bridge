// How loaded this computer is, and the limit that keeps it usable for its person.
//
// The bridge runs on a home computer that is also somebody's desktop. Three
// parallel turns are three Electron children, and the person typing in another
// window feels them first: the window that stops responding is not the bot's.
// A gauge alone explains the lag after it happened, so the reading comes with a
// limit, and `handle-message.mjs` checks that limit before starting one more turn.
//
// Everything here is `node:os` and `node:fs`: a load meter that needs a
// dependency is a load meter missing on the machine that needs it most.
import { statfsSync } from 'node:fs';
import { cpus, freemem, hostname, totalmem, uptime } from 'node:os';

const GB = 1024 ** 3;

/** One decimal: 4.9 GB is a reading, 4.907692 is a log line. */
export const round1 = (value) => Math.round(value * 10) / 10;

/**
 * What a turn may not push past, when the guard is on.
 *
 * The numbers are deliberately early: 85 % CPU already means every window is
 * waiting on the scheduler, and 8 % of memory left is where a browser starts
 * swapping. CPU is a ceiling; memory and disk are floors.
 */
export const GUARD_DEFAULTS = { enabled: false, cpuPct: 85, ramFreePct: 8, diskFreeGb: 10 };

/** `config.loadGuard` over the defaults; a bad number falls back instead of NaN. */
export function guardOf(raw) {
  const out = { ...GUARD_DEFAULTS };
  for (const key of ['cpuPct', 'ramFreePct', 'diskFreeGb']) {
    const value = Number(raw?.[key]);
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  }
  out.enabled = raw?.enabled === true;
  return out;
}

/** Cumulative CPU ticks. `os.cpus()` counts since boot, so one call says nothing. */
function cpuTicks() {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/**
 * Busy percentage over a window, 0..100.
 *
 * A window is the only honest way to ask: the average since boot is always a
 * calm number, and `os.loadavg()` is three zeros on Windows. 250 ms is long
 * enough to catch a build and short enough that `/load` still feels like a tap.
 */
export async function sampleCpu(windowMs = 250) {
  const first = cpuTicks();
  if (windowMs > 0) await new Promise((resolve) => setTimeout(resolve, windowMs));
  const second = cpuTicks();
  const total = second.total - first.total;
  const idle = second.idle - first.idle;
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(((total - idle) / total) * 100)));
}

/** The disk a path lives on: `C:\Users\...` -> `C:\`. */
export function driveOf(path, platform = process.platform) {
  if (platform !== 'win32') return '/';
  const match = /^([A-Za-z]:)[\\/]/.exec(String(path || ''));
  return match ? `${match[1]}\\` : `${process.env.SystemDrive || 'C:'}\\`;
}

/**
 * Free space on the disk that holds the turns.
 *
 * `statfsSync` throws on a path that does not exist, and a removed drive must
 * read as "unknown" rather than take the whole card down.
 */
export function sampleDisk(drive = driveOf('')) {
  try {
    const stat = statfsSync(drive);
    const totalGb = round1((stat.blocks * stat.bsize) / GB);
    const freeGb = round1((stat.bavail * stat.bsize) / GB);
    return { drive, freeGb, totalGb, freePct: totalGb > 0 ? Math.round((freeGb / totalGb) * 100) : 0 };
  } catch {
    return { drive, freeGb: null, totalGb: null, freePct: null };
  }
}

/** One reading of the whole machine, in the units the card prints. */
export async function sampleMachine({ cpuMs = 250, drive } = {}) {
  const totalGb = round1(totalmem() / GB);
  const freeGb = round1(freemem() / GB);
  return {
    at: Date.now(),
    host: hostname(),
    cores: cpus().length,
    cpuPct: await sampleCpu(cpuMs),
    ram: { freeGb, totalGb, freePct: totalGb > 0 ? Math.round((freeGb / totalGb) * 100) : 0 },
    disk: sampleDisk(drive),
    uptimeH: Math.round(uptime() / 3600),
  };
}

/**
 * Which limits this reading breaks, as `{ key, value, limit }`.
 *
 * A missing number is never a breach: "unknown" is not "full", and a guard that
 * fired on a null would refuse every turn after somebody unplugged a drive.
 */
export function breaches(sample, guard) {
  if (!guard?.enabled) return [];
  const out = [];
  if (Number.isFinite(sample?.cpuPct) && sample.cpuPct > guard.cpuPct) {
    out.push({ key: 'cpu', value: sample.cpuPct, limit: guard.cpuPct });
  }
  if (Number.isFinite(sample?.ram?.freePct) && sample.ram.freePct < guard.ramFreePct) {
    out.push({ key: 'ram', value: sample.ram.freePct, limit: guard.ramFreePct });
  }
  if (Number.isFinite(sample?.disk?.freeGb) && sample.disk.freeGb < guard.diskFreeGb) {
    out.push({ key: 'disk', value: sample.disk.freeGb, limit: guard.diskFreeGb });
  }
  return out;
}

/**
 * Requests a person held back by the guard, waiting for the "run anyway" button.
 *
 * In memory on purpose: a restart is exactly when the load is back to normal,
 * and a stored request replayed hours later would be a surprise, not a favour.
 */
export const held = new Map();

/** Keep at most this many; the oldest goes, because only the newest matter. */
const HELD_MAX = 8;

export function hold(id, payload) {
  held.set(id, payload);
  while (held.size > HELD_MAX) held.delete(held.keys().next().value);
  return id;
}

export function takeHeld(id) {
  const payload = held.get(id);
  if (payload) held.delete(id);
  return payload || null;
}