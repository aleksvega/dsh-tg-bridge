// The `/model` picker: every route a profile can run, as buttons.
//
// Its own table because the card is a screen of its own — the settings card and
// the command list each have one, and a picker that answers "where do the
// answers come from" belongs with them rather than in the middle of the
// control strings.
export default {
  'ctrl.model.pickTitle': '🎛 配置档 {profile} 的线路',
  'ctrl.model.pickNow': '当前：{route}',
  'ctrl.model.pickUnknown': '当前：配置档 {profile} 没有默认模型行',
  'ctrl.model.pickGroup': '— {provider} —',
  'ctrl.model.pickHint': '点一条线路即可切换。提供方和模型会一起变：同一个模型名可能由多个端点提供。',
  'ctrl.model.pickRefresh': '↻ 刷新',
  'ctrl.model.pickHidden': '还有 {n} 条线路没放下；任意一条都可以用 /model <提供方>/<模型> 指定。',
  'ctrl.model.pickLong': '配置档 {profile} 的每条线路名字都太长，放不进按钮；仍然可以用 /model <提供方>/<模型> 切换。',
  'ctrl.model.pickNone': '配置档 {profile} 没有可选的模型。',
  'ctrl.model.pickSwitched': '线路 {name} → {route}。下一轮生效。',
  'ctrl.model.pickStale': '配置档 {name} 里已经没有线路 {route} —— 画卡片之后配置档变了。/model 可以看现在的线路。',
};