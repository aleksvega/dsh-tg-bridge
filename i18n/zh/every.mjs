// `/every`：每日定时任务的措辞 —— 创建、列出、删除、拒绝。
//
// 单独一张表，和 `diff.mjs`、`endpoint.mjs` 一样：这条命令有自己的表面
// （四个动词和五种拒绝），它的句子要在三种语言里保持一致。这也让 `ctrl.mjs`
// 保持在 500 行上限之下 —— 再加十三行就会超过。
export default {
  'ctrl.help.about.every': '一个重复的定时任务：/every 09:00 文本 每天这个时间把文本当成普通轮次执行。/every list 显示这个聊天里的定时任务，/every rm 2 删除一个。',
  'ctrl.every.usage': '用法：/every 09:00 文本 —— 每天这个时间重复 · /every list · /every rm 1。',
  'ctrl.every.title': '🔁 每天',
  'ctrl.every.empty': '这个聊天还没有定时任务。',
  'ctrl.every.line': '{n}. {when} · 每天{topic} — {text}',
  'ctrl.every.topicLabel': '话题 {thread}',
  'ctrl.every.hint': '添加：/every 09:00 文本 · 删除：/every rm 1 · 文本以普通消息送达，由智能体执行。',
  'ctrl.every.added': '🔁 每天 {when} — {text}',
  'ctrl.every.rmDone': '已删除定时任务 {n}（{text}）。',
  'ctrl.every.rmUsage': '要删哪个？/every rm <列表中的编号>。',
  'ctrl.every.tooMany': '这个聊天已经有 {max} 个定时任务了 —— 请先删掉一个。',
  'ctrl.every.time': '看不懂这个时间。请用 09:00 —— 按这台机器的时钟每天重复。',
  'ctrl.every.text': '时间有了，文本没有：/every 09:00 检查构建。',
};
