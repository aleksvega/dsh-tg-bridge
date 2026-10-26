// The small schema a set is allowed to carry, and the buttons that edit one.
//
// Kept apart from `agentsets.mjs` (which stores whatever it is given) and from
// `control.mjs` (which is one long command handler) so the wire format can be
// tested on its own: a callback payload that cannot be parsed must never reach
// a write.
import { EDITABLE } from './settings.mjs';

/** The fields a set may override; anything else is refused at the door. */
export const FIELDS = EDITABLE;

/** Button data is capped at 64 bytes by Telegram; `as:` + verb + id + slot fits with room. */
export const CALLBACK_PREFIX = 'as:';
const VERBS = new Set(['use', 'off', 'edit', 'new', 'rm', 'show']);

/**
 * `as:<verb>:<setId>[:<slot>]` -> `{verb, id, slot}`, or null.
 * A slot is one of the editable fields plus the set-level actions; a verb that
 * needs an id without one is refused here rather than by the handler.
 */
export function parseCallback(data) {
  const text = String(data ?? '');
  if (!text.startsWith(CALLBACK_PREFIX)) return null;
  const [verb, id = '', slot = ''] = text.slice(CALLBACK_PREFIX.length).split(':');
  if (!VERBS.has(verb)) return null;
  // `off` names the set it was drawn for, so a stale button cannot unbind a
  // set bound after the card was sent; an empty id still means "this topic".
  if (verb === 'off') {
    if (id && !/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) return null;
    return { verb, id, slot };
  }
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) return null;
  return { verb, id, slot };
}

/** The payload for one button, or '' when it would not be understood. */
export function callbackData(verb, id, slot = '') {
  const data = `${CALLBACK_PREFIX}${verb}:${id}${slot ? `:${slot}` : ''}`;
  return data.length <= 64 ? data : '';
}

/**
 * The keyboard for a set card. Slots are the fields the set overrides plus the
 * two set-level actions; a slot the reader cannot resolve is dropped by the
 * caller, which passes `slots` — so a stale button never acts on another set.
 */
export function cardKeyboard(set, { bound = false, builtin = false, slots = [] } = {}) {
  if (!set) return [];
  const rows = [];
  if (!builtin) {
    rows.push([
      { text: bound ? '✓ in use' : 'Use', data: callbackData('use', set.id) },
      ...slots.slice(0, 2).map((slot) => ({ text: slot, data: callbackData('edit', set.id, slot) })),
    ]);
    if (slots.length > 2) rows.push(slots.slice(2, 5).map((slot) => ({ text: slot, data: callbackData('edit', set.id, slot) })));
  }
  const last = [{ text: 'show', data: callbackData('show', set.id) }];
  if (bound) last.push({ text: 'off', data: callbackData('off', set.id) });
  if (!builtin) last.push({ text: 'rm', data: callbackData('rm', set.id) });
  rows.push(last);
  return rows.filter((row) => row.every((button) => button.data));
}

/** A one-line field edit, the way a person types it: `/agentset model big-m1`. */
export function parseEditVerb(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  return { verb: words[0] || '', args: words.slice(1) };
}