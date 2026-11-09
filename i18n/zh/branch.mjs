// ZH strings for branching between topics.
//
// A table of its own for the reason this directory already splits tables: one
// feature, one file, one diff. It also keeps `ctrl.mjs` under the 500-line
// ceiling, which that table was sitting on.
export default {
  'ctrl.help.about.branch': "分支到另一个话题，两种形式。/branch <id> 把那个会话的副本带到这里：本话题接着它走，原会话完好。/branch new [n] 把本会话的副本带到一个新话题——整段，或从 n 轮之前。/rewind 卡片上的 🌿 按钮对最近的轮提供同样的操作。在本话题内部复制用 /rewind fork。分支是对话的快照：之后两者各自独立。",
  'ctrl.branch.usage': "分支有两种形式。/branch <id> —— 把那个会话的副本带到这里，本话题接着它走。/branch new [n] —— 把本会话的副本放到一个新话题，从 n 轮之前（不带数字则整段）。在本话题内部复制用 /rewind fork。",
  'ctrl.branch.confirm': "从第 {turn} 轮分支：副本保留前 {kept} 轮，原会话保持完好。副本放到哪里？",
  'ctrl.branch.here': "在本话题",
  'ctrl.branch.new': "新话题",
  'ctrl.branch.hereDone': "分支已建立：本话题继续 {id}，保留 {kept} 轮。原会话完好。",
  'ctrl.branch.topicDone': "已打开话题「{name}」，其中是本会话的副本（{id}），{kept} 轮。本话题未改动。",
  'ctrl.branch.topicFailed': "无法打开话题——没有话题权限，或 Telegram 限制。副本已删除，什么都没变。",
  'ctrl.branch.unsupported': "此版本无法打开话题：不能分支到新话题。",
  'ctrl.branch.seed': "来自话题「{name}」的分支：会话的副本，{kept} 轮。在这里工作——原话题未改动。",
  'ctrl.branch.suffix': "分支",
  'ctrl.branch.untitled': "未命名",
};
