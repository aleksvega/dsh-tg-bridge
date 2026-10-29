// A sandbox refusal is a decision, not a crash — and these are the words that
// say so. Their own table because the distinction between "the policy said no"
// and "the sandbox itself broke" is the whole point of the feature, and a
// reader of `ctrl.mjs` should not have to hold both meanings in mind.
export default {
  'sandbox.times': '本轮共发生 {n} 次。',
  'sandbox.denied': '🔒 沙箱拒绝了这次操作：在「{mode}」模式下不允许写入。这是策略在起作用，不是故障 —— 任务停在了被允许的边界。',
  'sandbox.runner': '🔒 沙箱本身在「{mode}」模式下失败，命令并未运行。这是沙箱的问题，不是任务的问题 —— /doctor 会说明本机是否可用沙箱运行器。',
  'sandbox.open': '🔐 更改权限',
};
