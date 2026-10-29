// A sandbox refusal is a decision, not a crash — and these are the words that
// say so. Their own table because the distinction between "the policy said no"
// and "the sandbox itself broke" is the whole point of the feature, and a
// reader of `ctrl.mjs` should not have to hold both meanings in mind.
export default {
  'sandbox.times': 'It happened {n} times in this turn.',
  'sandbox.denied': '🔒 The sandbox refused this: writes are not allowed under \"{mode}\" mode. This is the policy doing its job, not a failure — the turn stopped where it was told to stop.',
  'sandbox.runner': '🔒 The sandbox itself failed under \"{mode}\" mode, so the command never ran. That is a sandbox problem, not a failure of the task — /doctor says whether the runner is available on this machine.',
  'sandbox.open': '🔐 Change permissions',
};
