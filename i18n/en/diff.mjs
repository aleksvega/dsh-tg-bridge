// `/diff` and its buttons: the review loop, from a phone.
//
// Kept out of `ctrl.mjs` because it is a surface of its own — the card, the two
// buttons per hunk and the four ways a press can end — and it has to agree with
// itself in three languages.
export default {
  'diff.noChanges': 'No changes in the working tree.',
  'diff.head': '{files} file(s) changed, +{added} -{removed}',
  'diff.untracked': 'new, not added yet: {list}',
  'diff.newFile': 'new',
  'diff.deletedFile': 'deleted',
  'diff.renamedFile': 'renamed',
  'diff.binaryFile': 'binary',
  'diff.truncated': '…{n} more hunk(s) left out — they do not fit in one message.',
  'diff.truncatedFiles': '…{n} more file(s) left out for the same reason.',
  'diff.tooManyButtons': 'Only the first hunks have buttons; {n} more are in the diff but not on the keyboard.',
  'diff.refresh': '🔄 Refresh',
  'diff.explainShort': '💭 line {line}',
  'diff.revertShort': '↩️ line {line}',
  'diff.refreshed': 'Refreshed.',
  'diff.explaining': 'Asking about that hunk.',
  'diff.explainPrompt': 'Explain what this hunk changes in {file} (around line {line}), and say whether it is right.',
  'diff.stale': 'That hunk is not in the diff any more — the file changed since the card was drawn. Send /diff again.',
  'diff.reverted': 'Reverted that hunk in {file} (line {line}).',
  'diff.revertFailed': 'Could not revert that hunk: {why}. The file is untouched.',
  'diff.noReason': 'git gave no reason',
  'diff.notRepo': '{dir} is not a git repository, so there is nothing to compare.',
  'diff.noDir': 'this topic has no directory yet — set one with /cd',
  'menu.cmd.diff': 'What this turn changed: one hunk at a time, with explain and revert',
  'ctrl.help.about.diff': 'What the turn changed in this topic, one hunk at a time. Every hunk gets two buttons: explain it, or revert just that hunk. `/diff stat` is the file list alone.',
};
