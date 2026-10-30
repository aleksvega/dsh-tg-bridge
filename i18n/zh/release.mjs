// 版本可信度：这个安装已经证明它能跑的那份代码。
//
// 不放在 `ctrl.mjs` 里，因为它不是某条命令的事：卡片、回退通知和 `/update`
// 说的都是磁盘上的同一批文件，三种语言必须一致。
export default {
  'rel.proven': '已验证：{n} 次回合有回答',
  'rel.unproven': '尚未验证——还没在上面跑过回合',
  'rel.faulted': '有故障：{n} 次代码错误',
  'rel.lastGood': '上一个已验证版本：{v}',
  'rel.none': '还没有已验证的版本记录',
  'rel.rolledBack': '版本 {v} 跑不起来：代码在第一个回合就崩了，所以退回 {to}。桥接会自行重启，继续用已验证的版本。',
  'rel.rolledBackBackup': '版本 {v} 跑不起来：代码崩了。仓库连不上，所以用上次更新保存的副本恢复了 {to}。',
  'rel.rollbackFailed': '退不回 {v}：{why}。文件保持原样——没有用猜测替换任何东西。',
  'rel.manualCurrent': '当前已经是已验证版本 {v}。',
  'rel.manualNone': '还没有已验证的版本：先要让一个回合在当前版本上正常回答。',
  'rel.manualDone': '已恢复 {v}。发送 /restart confirm 加载它。',
};
