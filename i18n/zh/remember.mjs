// ZH strings for long-term memory (/remember).
//
// A table of its own for the same reason `branch.mjs` is: one feature, one
// file, one diff, and `ctrl.mjs` stays off the 500-line ceiling.
export default {
  'ctrl.help.about.remember': "长期记忆：/remember <事实> 会在 AGENTS.md 的 Learned 小节追加一行带日期的记录——那是每次请求前代理都会读的文件。/remember 显示小节，/remember tidy 发起一个让代理自己清理过期内容的回合，/remember forget <词> 或 forget all 负责删除。看得见的记忆。",
  'ctrl.remember.saved': "记住了（现存 {count} 条）。",
  'ctrl.remember.dropped': "记住了（现存 {count} 条）——记忆已满，挤掉了最旧的 {dropped} 条。/remember tidy 可以压缩列表。",
  'ctrl.remember.list': "记忆共 {n} 条，最近的是：\n{list}",
  'ctrl.remember.empty': "记忆是空的。/remember <事实>——一行带日期的记录就会进入 AGENTS.md，代理每次请求前都会看的地方。",
  'ctrl.remember.tidy': "已发起回合：代理会重读自己的记忆，合并重复并清掉过期的。报告会以消息形式到达。",
  'ctrl.remember.task': "整理你自己的记忆。打开 DSH_HOME 里的 AGENTS.md，找到小节《## Learned (DSH memory)》：逐行重读，合并重复与相似项，删掉过期和再也不会用到的，保留日期。小节保持在 60 行以内，文件其余部分不要动。用你的写入工具改文件，然后用一份清单回答：删了什么、留了什么、为什么。",
  'ctrl.remember.forgot': "删除了 {n} 条，还剩 {count} 条。",
  'ctrl.remember.forgotAll': "记忆小节已清空——文件其余部分原样保留。",
  'ctrl.remember.notFound': "记忆里没有「{word}」——没有删除任何内容。",
  'ctrl.remember.noTurn': "这里无法从命令发起回合——请用 /edit 手动整理记忆。",
};
