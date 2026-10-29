// The `/cost` card. Its own table because the numbers, their provenance and
// their three kinds of "unknown" are one subject, and `ctrl.mjs` is a list of
// one-line answers to commands rather than a place for a report.
export default {
  'ctrl.cost.head': '💰 What this session has cost',
  'ctrl.cost.model': 'Model: {route}',
  'ctrl.cost.none': 'No usage recorded yet — nothing has been billed in this session.',
  'ctrl.cost.tokens': 'Tokens: {input} in · {output} out · {cache} from cache',
  'ctrl.cost.turns': 'Turns: {n} · average answer {avg} tokens',
  'ctrl.cost.total': 'Total: {sum}',
  'ctrl.cost.split': 'Input {input} · output {output} · cache {cache}',
  'ctrl.cost.perTurn': 'Per turn: {sum}',
  'ctrl.cost.source': 'Prices: OpenRouter for {id} — {input} in / {output} out per 1M, fetched {when}. This is a market reference, not your provider invoice.',
  'ctrl.cost.partial': 'One part of the bill has no published rate — the total is a lower bound.',
  'ctrl.cost.noPrice': 'OpenRouter does not price {route}, so there is no total — only the token counts above.',
  'ctrl.cost.noCatalog': 'No price catalog cached yet. Run /cost again to fetch one, or /prices to see the list.',
};
