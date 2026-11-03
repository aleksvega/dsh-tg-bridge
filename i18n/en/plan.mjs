// Plan mode words. Its own table because the feature is a pair of decisions —
// what the switch says, and what the card promises — and a reader looking for
// either should find both in one file rather than spread across `ctrl`.
export default {
  'ctrl.planmode.onHead': '🗺 Plan mode is on for this topic',
  'ctrl.planmode.offHead': '🗺 Plan mode is off for this topic',
  'ctrl.planmode.onBody': 'The next turns bring a plan instead of changes: files, commands and records stay as they are. Each one ends with an Approve / Keep planning card.',
  'ctrl.planmode.offBody': 'The next turns work normally again: no plan and no approval card.',
  'ctrl.planmode.guaranteeSandbox': 'The guarantee is the sandbox: the topic profile runs the read-only preset, so the machine itself refuses a write, not the model\'s promise.',
  'ctrl.planmode.guaranteeModel': 'The guarantee is the model\'s promise, not a sandbox rule: the topic preset is not read-only, so a write is technically possible. See /permissions for what is set.',
  'ctrl.planmode.cardHead': '🗺 The plan is ready. Approve runs it and turns plan mode off; Keep planning asks for a revision with no change at all.',
  'ctrl.planmode.approve': '✅ Approve',
  'ctrl.planmode.keep': '✏️ Keep planning',
  'ctrl.planmode.approved': 'Approved: running the same request, plan mode is off.',
  'ctrl.planmode.kept': 'Still planning: nothing will be changed.',
  'ctrl.planmode.stale': 'This card is stale: the plan has changed since. Nothing is run — send the task again.',
  'ctrl.planmode.offNow': 'Plan mode is already off, so there is nothing to run. Send the task and it will be done without a plan.',
  'ctrl.planmode.revised': 'Revise the plan along that note, changing nothing.',
  'prompt.planMode': 'PLAN MODE is on for this topic. Produce a plan and change nothing: do not edit files, do not run commands that change or create anything, do not commit. Reading and looking are fine. If the work needs a change, describe it as a step of the plan and wait for approval. The answer is the plan itself: short steps, what and why, and what could go wrong.',
};
