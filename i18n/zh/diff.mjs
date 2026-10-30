// `/diff` 及其按钮：在手机上完成审阅。
//
// 不放在 `ctrl.mjs` 里，因为它自成一套界面——卡片、每个 hunk 的两个按钮、按下
// 之后的四种结局——三种语言必须说同一件事。
export default {
  'diff.noChanges': '工作区没有改动。',
  'diff.head': '改了 {files} 个文件，+{added} -{removed}',
  'diff.untracked': '新增但还没加入版本库：{list}',
  'diff.newFile': '新增',
  'diff.deletedFile': '删除',
  'diff.renamedFile': '重命名',
  'diff.binaryFile': '二进制',
  'diff.truncated': '……还有 {n} 个 hunk 没显示——一条消息放不下。',
  'diff.truncatedFiles': '……还有 {n} 个文件因同样原因没显示。',
  'diff.tooManyButtons': '只有前面的 hunk 有按钮；还有 {n} 个在 diff 里，但没放到键盘上。',
  'diff.refresh': '🔄 刷新',
  'diff.explainShort': '💭 第 {line} 行',
  'diff.revertShort': '↩️ 第 {line} 行',
  'diff.refreshed': '已刷新。',
  'diff.explaining': '正在问这个 hunk。',
  'diff.explainPrompt': '解释这个 hunk 在 {file} 里改了什么（大约第 {line} 行），并说明它对不对。',
  'diff.stale': '这个 hunk 已经不在 diff 里了——卡片画出之后文件变了。请再发一次 /diff。',
  'diff.reverted': '已回退 {file} 里这个 hunk（第 {line} 行）。',
  'diff.revertFailed': '没能回退这个 hunk：{why}。文件没有被改动。',
  'diff.noReason': 'git 没给出原因',
  'diff.notRepo': '{dir} 不是 git 仓库，没有可比较的内容。',
  'diff.noDir': '这个话题还没有目录——用 /cd 设置',
  'menu.cmd.diff': '这一回合改了什么：逐个 hunk 查看，可解释也可回退',
  'ctrl.help.about.diff': '这个话题里这一回合改了什么，一个 hunk 一个 hunk 地看。每个 hunk 有两个按钮：解释它，或者只回退它。`/diff stat` 只看文件列表。',
};
