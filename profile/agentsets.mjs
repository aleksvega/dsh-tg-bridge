/**
 * Agent sets: named bundles of per-topic agent settings that live next to
 * state.json in their own file.
 *
 * Why not state.json: `saveState()` runs on every poll tick, so a preset blob
 * would be re-serialised hundreds of times an hour, and a corrupt state.json
 * already costs every topic its session — the two failure modes must not share
 * a file. This store keeps its own revision counter and compare-and-swap so a
 * write from a second process cannot silently drop a set saved 200 ms earlier.
 *
 * A set is a DELTA, never absolute: '' / [] / {} means "inherit from the
 * profile". That is what lets two topics share one set object without one
 * topic's later edit leaking into the other.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';

export const ASETS_FILE = 'agentsets.json';
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const TRASH_TTL = 7 * 24 * 60 * 60 * 1000;
const TRASH_CAP = 20;

/** JSON of every set as it was loaded: what a rebase has to tell apart. */
function snapshot(sets) {
  return JSON.parse(JSON.stringify(sets));
}

/** Fields a set may carry. Anything else is preserved but never read. */
export const FIELDS = ['model', 'provider', 'effort', 'permissions', 'dshPreset', 'lang', 'thinkBlock', 'base', 'notes'];
export const LIST_FIELDS = ['plugins', 'toolFilter', 'agents'];

export function emptySet(id, name = id) {
  const now = new Date().toISOString();
  return {
    id,
    name,
    builtin: false,
    schema: 1,
    createdAt: now,
    updatedAt: now,
    base: '',
    model: '',
    provider: '',
    effort: '',
    permissions: '',
    dshPreset: '',
    plugins: { add: [], remove: [], disable: [], enable: [] },
    toolFilter: { deny: [], allow: [] },
    agents: {},
    lang: '',
    thinkBlock: '',
    notes: '',
  };
}

/** What every install gets for free. Read-only in Telegram: edit a copy. */
export function builtinSets() {
  const make = (id, name, patch) => ({ ...emptySet(id, name), builtin: true, ...patch });
  return {
    normal: make('normal', 'Normal', {}),
    careful: make('careful', 'Careful', { permissions: 'read-only', notes: 'Reads and plans, asks before writing.' }),
    fast: make('fast', 'Fast', { effort: 'low', notes: 'Lowest declared effort: quick answers, less thinking.' }),
    reviewer: make('reviewer', 'Reviewer', {
      permissions: 'read-only',
      effort: 'high',
      notes: 'Reads the diff, reports findings, changes nothing.',
    }),
  };
}

export class AgentsetStore {
  constructor(file) {
    this.file = file;
    this.data = null;
    /** Every set as loaded, so a rebase can find this handle's own edits. */
    this.before = {};
    this.error = '';
  }

  /** Never throws: a broken file falls back to the builtins and reports why. */
  load() {
    const seed = { version: 1, rev: 0, updatedAt: new Date().toISOString(), sets: builtinSets(), trash: [] };
    if (!existsSync(this.file)) {
      this.data = seed;
      this.before = snapshot(seed.sets);
      this.error = '';
      return this;
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
      if (!raw || typeof raw !== 'object' || typeof raw.sets !== 'object' || raw.sets === null) {
        throw new Error('not an object with a sets map');
      }
      this.data = {
        version: 1,
        rev: Number(raw.rev) || 0,
        updatedAt: raw.updatedAt || seed.updatedAt,
        sets: { ...builtinSets(), ...raw.sets },
        trash: Array.isArray(raw.trash) ? raw.trash : [],
      };
      this.before = snapshot(this.data.sets);
      this.error = '';
    } catch (error) {
      this.data = seed;
      this.before = snapshot(seed.sets);
      this.error = `agentsets.json unreadable (${error.message}); builtins only`;
    }
    this.dropExpiredTrash();
    return this;
  }

  get sets() {
    if (!this.data) this.load();
    return this.data.sets;
  }

  list() {
    return Object.values(this.sets).sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.id.localeCompare(b.id));
  }

  get(id) {
    return this.sets[id] || null;
  }

  /** Create or replace one set. Returns { ok } or { ok:false, error }. */
  put(set) {
    if (!set || !ID.test(String(set.id || ''))) return { ok: false, error: 'bad-id' };
    if (this.sets[set.id]?.builtin) return { ok: false, error: 'builtin-readonly' };
    const now = new Date().toISOString();
    const prev = this.sets[set.id];
    this.sets[set.id] = {
      ...emptySet(set.id, set.name || set.id),
      ...prev,
      ...set,
      builtin: false,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };
    return this.save();
  }

  /** Delete one set into the trash. Never touches state.json bindings. */
  remove(id) {
    const set = this.sets[id];
    if (!set) return { ok: false, error: 'missing' };
    if (set.builtin) return { ok: false, error: 'builtin-readonly' };
    delete this.sets[id];
    this.data.trash = [{ set, deletedAt: Date.now() }, ...this.data.trash].slice(0, TRASH_CAP);
    return this.save();
  }

  /** Restore a deleted set. Returns the set or null. */
  restore(id) {
    const at = this.data.trash.findIndex((entry) => entry.set?.id === id);
    if (at < 0) return null;
    const [{ set }] = this.data.trash.splice(at, 1);
    this.sets[id] = set;
    return this.save().ok ? set : null;
  }

  trashList() {
    if (!this.data) this.load();
    this.dropExpiredTrash();
    return this.data.trash.map((entry) => entry.set.id);
  }

  dropExpiredTrash() {
    if (!this.data) return;
    const cut = Date.now() - TRASH_TTL;
    this.data.trash = this.data.trash.filter((entry) => Number(entry.deletedAt) > cut);
  }

  /**
   * Compare-and-swap write: re-read the file's rev, refuse if somebody else
   * bumped it since this handle loaded, and never reconstruct the object from
   * known keys (a newer field must survive a downgrade).
   */
  save() {
    const disk = this.diskRev();
    if (disk === null) return { ok: false, error: 'unreadable', file: this.file };
    if (disk !== this.data.rev) {
      // One silent rebase instead of a failed write: re-read what the other
      // writer saved, stamp this handle's edits on top of it, write once more.
      const rev = this.data.rev;
      const carried = Object.keys(this.data.sets)
        .filter((id) => !this.before[id] || JSON.stringify(this.before[id]) !== JSON.stringify(this.data.sets[id]))
        .map((id) => [id, this.data.sets[id]]);
      this.load();
      if (this.error || this.data.rev !== disk) return { ok: false, error: 'stale', diskRev: disk, rev };
      // New, edited and deleted sets belong to this handle; everything else is
      // whatever the other writer left on disk.
      for (const [id, set] of carried) if (set) this.sets[id] = set;
    }
    this.data.rev += 1;
    this.data.updatedAt = new Date().toISOString();
    const text = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.tmp-${process.pid}`;
    try {
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, text, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.file);
    } catch (error) {
      // Fall back to a plain write: losing the atomic swap is better than
      // losing the edit, and the file is small enough that a torn write needs
      // a crash in the same millisecond.
      try {
        writeFileSync(this.file, text, 'utf8');
      } catch (inner) {
        return { ok: false, error: inner.message };
      }
    }
    return { ok: true, rev: this.data.rev };
  }

  diskRev() {
    try {
      if (!existsSync(this.file)) return 0;
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
      return Number(raw?.rev) || 0;
    } catch {
      return null;
    }
  }
}

/** `normal`, `My Set` → `my-set`; `''` when nothing usable is left. */
export function slugId(input) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  return ID.test(slug) ? slug : '';
}
