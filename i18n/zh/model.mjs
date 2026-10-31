// The `/model` picker: every route a profile can run, as buttons.
//
// Its own table because the card is a screen of its own — the settings card and
// the command list each have one, and a picker that answers "where do the
// answers come from" belongs with them rather than in the middle of the
// control strings.
export default {
  'ctrl.model.pickTitle': '🎛 配置档 {profile} 的线路',
  'ctrl.model.pickNow': '当前：{route}',
  'ctrl.model.pickNowTopic': '本话题：{route}',
  'ctrl.model.pickNowDefault': '档案默认：{route} —— 未单独选择的话题',
  'ctrl.model.pickFollow': '↩ 恢复跟随档案',
  'ctrl.model.topicSet': '本话题现在走 {route}。其他话题仍为 {default}。',
  'ctrl.model.topicCleared': '本话题恢复跟随档案：{route}。',
  'ctrl.model.topicNone': '本话题本来就没有单独路线，一直跟随档案：{route}。',
  'ctrl.model.topicKept': '保留自己路线的有 {n} 个话题。',
  'ctrl.model.pickUnknown': '当前：配置档 {profile} 没有默认模型行',
  'ctrl.model.pickHint': '点一条线路即可切换。提供方和模型会一起变：同一个模型名可能由多个端点提供。',
  'ctrl.model.pickRefresh': '↻ 刷新',
  'ctrl.model.pickHidden': '还有 {n} 条线路没放下；任意一条都可以用 /model <提供方>/<模型> 指定。',
  'ctrl.model.pickLong': '配置档 {profile} 的每条线路名字都太长，放不进按钮；仍然可以用 /model <提供方>/<模型> 切换。',
  'ctrl.model.pickNone': '配置档 {profile} 没有可选的模型。',
  'ctrl.model.pickSwitched': '线路 {name} → {route}。下一轮生效。',
  'ctrl.model.pickStale': '配置档 {name} 里已经没有线路 {route} —— 画卡片之后配置档变了。/model 可以看现在的线路。',
  'ctrl.model.scopeAllOn': '🌍 全局切换 ▸ 点此改为仅本话题',
  'ctrl.model.scopeTopicOn': '💬 仅本话题 ▸ 点此改为全局',
  'ctrl.model.scopeAllHead': '「全局」模式：配置档当前默认 {route}。点某条线路，所有没有自己线路的话题都会切过去。',
  'ctrl.model.scopeAllHint': '选一条线路，它就成为整个配置档的默认。已有自己线路的话题不受影响 —— 那些要在「仅本话题」模式下逐个切换。',
  'ctrl.model.scopeAllSet': '现在点击会改动整个配置档。',
  'ctrl.model.scopeTopicSet': '现在点击只会改动本话题。',
};