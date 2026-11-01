// Which blocks the finished-turn card shows, and the card that chooses them.
//
// The card is one message per turn, and what belongs in it is a matter of taste:
// someone chasing a slow provider wants the speed and the cache line, someone
// reading answers wants the step list gone. The choice is per topic and lives in
// `state`, so the next turn reads it back without a command.
import { t } from '../core/i18n.mjs';

/**
 * Every block the card can carry, in the order the card shows them.
 *
 * `time` is not optional: a card without a duration is not a summary of a turn,
 * and turning it off would leave the card with no head at all — so `/card`
 * offers it like any other row and the renderer keeps the head either way.
 */
export const CARD_BLOCKS = ['time', 'speed', 'thoughts', 'steps', 'context', 'cost', 'cache', 'reasoning'];

/**
 * The blocks this topic keeps.
 *
 * A topic that never chose gets every block: that is what the card looked like
 * before the choice existed, and an update must not silently shorten it. An id
 * this build no longer knows is dropped rather than rendered as an empty row.
 */
export function cardBlocks(state, key) {
  const chosen = state?.cardBlocks?.[key];
  if (!Array.isArray(chosen)) return new Set(CARD_BLOCKS);
  // Canonical order, not the stored one: the card is read top to bottom, and a
  // list that depends on the order buttons were pressed in would be a different
  // card after every restart.
  return new Set(CARD_BLOCKS.filter((id) => chosen.includes(id)));
}

/**
 * Flip one block and return the list to store, in the card's own order.
 *
 * `null` for an id this build does not know: the caller answers "stale card"
 * instead of writing a key nobody reads.
 */
export function toggleCardBlock(state, key, id) {
  if (!CARD_BLOCKS.includes(id)) return null;
  const blocks = cardBlocks(state, key);
  if (blocks.has(id)) blocks.delete(id);
  else blocks.add(id);
  return CARD_BLOCKS.filter((block) => blocks.has(block));
}

/** One button per block: a tick means the block is on. Two per row. */
export function cardKeyboard(blocks, lang) {
  const rows = [];
  for (const id of CARD_BLOCKS) {
    const on = blocks.has(id);
    const button = { text: `${on ? '✅' : '⬜'} ${t(lang, `card.b.${id}`)}`, callback_data: `tc:${id}` };
    const last = rows[rows.length - 1];
    if (last && last.length === 1) last.push(button);
    else rows.push([button]);
  }
  return rows;
}

/** The card itself: what the next finished turn will show. */
export function renderCardSettings(blocks, lang) {
  const on = CARD_BLOCKS.filter((id) => blocks.has(id));
  return [
    `🗂 ${t(lang, 'card.title')}`,
    '',
    on.length ? on.map((id) => `• ${t(lang, `card.b.${id}`)}`).join('\n') : t(lang, 'card.none'),
    '',
    t(lang, 'card.hint'),
  ].join('\n');
}
