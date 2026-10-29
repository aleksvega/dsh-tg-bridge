// The `/cost` card. Its own table because the numbers, their provenance and
// their three kinds of "unknown" are one subject, and `ctrl.mjs` is a list of
// one-line answers to commands rather than a place for a report.
export default {
  'ctrl.cost.head': '💰 本次会话花费',
  'ctrl.cost.model': '模型：{route}',
  'ctrl.cost.none': '暂无用量记录 —— 本次会话还没有产生费用。',
  'ctrl.cost.tokens': 'Token：输入 {input} · 输出 {output} · 缓存命中 {cache}',
  'ctrl.cost.turns': '轮次：{n} · 平均回答 {avg} token',
  'ctrl.cost.total': '合计：{sum}',
  'ctrl.cost.split': '输入 {input} · 输出 {output} · 缓存 {cache}',
  'ctrl.cost.perTurn': '每轮：{sum}',
  'ctrl.cost.source': '价格：OpenRouter 的 {id} —— 每 1M 输入 {input} / 输出 {output}，抓取于 {when}。这是市场参考价，不是你的供应商账单。',
  'ctrl.cost.partial': '账单中有一部分没有公开费率 —— 合计是下限。',
  'ctrl.cost.noPrice': 'OpenRouter 没有 {route} 的价格，所以没有合计 —— 只有上面的 token 计数。',
  'ctrl.cost.noCatalog': '还没有价格缓存。再执行一次 /cost 去抓取，或用 /prices 看列表。',
};
