// `/card`: what the finished-turn card carries, chosen with buttons.
//
// The card used to be the same for everyone — speed, steps, reasoning, context,
// cost and cache in one message — and the only way to have less was to scroll.
// The choice is per topic, because the topic is where the reading happens.
import { cardBlocks, cardKeyboard, renderCardSettings } from '../turn/card.mjs';

export async function handleCardCommands(ctx) {
  const { effective, state, key, lang, reply } = ctx;
  switch (effective) {
    case '/card': {
      const blocks = cardBlocks(state, key);
      await reply(renderCardSettings(blocks, lang), { keyboard: cardKeyboard(blocks, lang) });
      return true;
    }
    default:
      return false;
  }
}
