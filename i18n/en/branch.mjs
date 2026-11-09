// EN strings for branching between topics.
//
// A table of its own for the reason this directory already splits tables: one
// feature, one file, one diff. It also keeps `ctrl.mjs` under the 500-line
// ceiling, which that table was sitting on.
export default {
  'ctrl.help.about.branch': "A branch into another topic, in two forms. /branch <id> brings a copy of that session here: this topic continues it, the original stays whole. /branch new [n] carries a copy of this session into a new topic — the whole thing, or from n turns back. The 🌿 buttons on the /rewind card offer the same for recent turns. A copy inside this topic is /rewind fork. A branch is a snapshot of the conversation: from there the two live on their own.",
  'ctrl.branch.usage': "A branch has two forms. /branch <id> — a copy of that session here, this topic continues it. /branch new [n] — a copy of this session in a new topic, from n turns back (without a number, the whole thing). A copy inside this topic is /rewind fork.",
  'ctrl.branch.working': "Copying the session…",
  'ctrl.branch.confirm': "Branch from turn {turn}: the copy keeps the first {kept} turn(s); the original session stays whole. Where should the copy go?",
  'ctrl.branch.here': "In this topic",
  'ctrl.branch.new': "New topic",
  'ctrl.branch.hereDone': "Branched: this topic now continues {id}, keeping {kept} turn(s). The original session is untouched.",
  'ctrl.branch.topicDone': "Opened the topic \"{name}\" with a copy of this session ({id}), {kept} turn(s). This topic is untouched.",
  'ctrl.branch.topicFailed': "Could not open the topic — no topic permission, or a Telegram limit. The copy was removed; nothing changed.",
  'ctrl.branch.unsupported': "This build cannot open topics: branching into a new topic is unavailable.",
  'ctrl.branch.seed': "A branch of \"{name}\": a copy of the session, {kept} turn(s). Work here — the original topic is untouched.",
  'ctrl.branch.suffix': "branch",
  'ctrl.branch.untitled': "Untitled",
  // The fork family moved here from ctrl.mjs: a fork is a branch that stays in
  // this topic, and the ctrl table was at the 500-line ceiling.
  'ctrl.fork.done': "Branched: this topic now continues in {id}, keeping {kept} turn(s). The old session is untouched — /rewind branches lists both.",
  'ctrl.fork.noSession': "This topic has no session yet: the first message starts one.",
  'ctrl.fork.busy': "A turn is running in this topic. A run writes its session, so branch after it finishes.",
  'ctrl.fork.usage': "Usage: /rewind fork — a copy from here, or /rewind fork 2 — a copy from two turns back.",
  'ctrl.fork.working': "Copying the session…",
  'ctrl.fork.failed': "Could not branch: {error}",
  'ctrl.fork.none': "No branches in this topic yet. /rewind fork makes one.",
  'ctrl.fork.list': "{n} branch(es) of this topic:",
  'ctrl.fork.current': "This topic is on {id}.",
  'ctrl.fork.turns': "{n} turn(s)",
};
