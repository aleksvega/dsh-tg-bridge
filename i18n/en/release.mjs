// Release trust: which version this install has proved it can run.
//
// Kept out of `ctrl.mjs` because it is not about a command: it is what the card,
// the rollback notice and `/update` all say about the files on disk, and it has
// to agree with itself in three languages.
export default {
  'rel.proven': 'proven: {n} turns answered',
  'rel.unproven': 'not proven yet — no turn has run on it',
  'rel.faulted': 'failing: {n} code faults',
  'rel.lastGood': 'last proven: {v}',
  'rel.none': 'no proven version on record yet',
  'rel.rolledBack': 'Version {v} did not run: it threw a code fault, so I went back to {to}. The bridge restarts itself and continues on the proven release.',
  'rel.rolledBackBackup': 'Version {v} did not run: it threw a code fault. The registry was unreachable, so I restored {to} from the copy the last update saved.',
  'rel.rollbackFailed': 'Could not go back to {v}: {why}. The files are where they were — nothing was replaced by a guess.',
  'rel.manualCurrent': 'Already on the proven version {v}.',
  'rel.manualNone': 'No proven version on record yet: one turn has to answer on the current release first.',
  'rel.manualDone': 'Restored {v}. Send /restart confirm to load it.',
};
