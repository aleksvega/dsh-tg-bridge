// Plan mode words. Its own table because the feature is a pair of decisions —
// what the switch says, and what the card promises — and a reader looking for
// either should find both in one file rather than spread across `ctrl`.
export default {
  'ctrl.planmode.onHead': '🗺 本话题已开启计划模式',
  'ctrl.planmode.offHead': '🗺 本话题已关闭计划模式',
  'ctrl.planmode.onBody': '接下来的回合给出计划而不是改动：文件、命令和记录都保持原样。每回合结束时会有「批准」和「继续计划」两个按钮。',
  'ctrl.planmode.offBody': '接下来的回合恢复正常：不再有计划和批准按钮。',
  'ctrl.planmode.guaranteeSandbox': '保证来自沙箱：本话题的配置使用 read-only 预设，拒绝写入的是机器本身，而不是模型的承诺。',
  'ctrl.planmode.guaranteeModel': '保证来自模型的承诺，而不是沙箱规则：本话题的预设不是 read-only，技术上仍然可以写入。具体设置见 /permissions。',
  'ctrl.planmode.cardHead': '🗺 计划已就绪。「批准」会执行并关闭计划模式；「继续计划」只做修订，不做任何改动。',
  'ctrl.planmode.approve': '✅ 批准',
  'ctrl.planmode.keep': '✏️ 继续计划',
  'ctrl.planmode.approved': '已批准：正在执行同一个请求，计划模式已关闭。',
  'ctrl.planmode.kept': '继续计划：不会做任何改动。',
  'ctrl.planmode.stale': '这张卡片已过期：计划此后发生了变化。不会执行任何操作 —— 请重新发送任务。',
  'ctrl.planmode.offNow': '计划模式已经关闭，没有可执行的内容。发来任务，我会不做计划直接完成。',
  'ctrl.planmode.revised': '按这条意见修订计划，不要做任何改动。',
  'prompt.planMode': '本话题已开启计划模式。给出计划，不要改动任何东西：不要修改文件，不要运行会改变或创建内容的命令，不要提交。查看和阅读可以。若工作需要改动，请把它写进计划的步骤并等待批准。回答就是计划本身：简短步骤、做什么与为什么、可能出错的地方。',
};
