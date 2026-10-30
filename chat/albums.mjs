// Album batching.
//
// Telegram delivers an album as one update per file, a few hundred ms apart,
// all sharing a `media_group_id`. Buffering them by that id turns "ten photos"
// into one hand-over instead of ten steers or ten turns.
//
// The wait is quiet-based: it restarts with each new item so a slow upload is
// not cut off, and it is capped by `maxMs` so one stuck item cannot hold the
// batch forever.

export function createAlbumBuffer({ quietMs = 1200, maxMs = 4000, onFlush } = {}) {
  if (typeof onFlush !== 'function') throw new Error('createAlbumBuffer needs onFlush');
  const groups = new Map();

  return {
    /** Add one item to its group; returns how long until the group flushes. */
    push(key, item, now = Date.now()) {
      const entry = groups.get(key) || { items: [], timer: null, started: now };
      entry.items.push(item);
      if (entry.timer) clearTimeout(entry.timer);
      const left = maxMs - (now - entry.started);
      const wait = Math.max(0, Math.min(quietMs, left));
      entry.timer = setTimeout(() => {
        if (groups.get(key) === entry) groups.delete(key);
        onFlush(entry.items, key);
      }, wait);
      entry.timer.unref?.();
      groups.set(key, entry);
      return wait;
    },

    /** Groups still collecting; 0 means nothing is pending. */
    pending() {
      return groups.size;
    },
  };
}
