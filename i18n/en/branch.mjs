// EN strings for branching between topics.
//
// A table of its own for the reason this directory already splits tables: one
// feature, one file, one diff. It also keeps `ctrl.mjs` under the 500-line
// ceiling, which that table was sitting on.
export default {
  'ctrl.help.about.branch': "A branch into another topic, in two forms. /branch <id> brings a copy of that session here: this topic continues it, the original stays whole. /branch new [n] carries a copy of this session into a new topic — the whole thing, or from n turns back. The 🌿 buttons on the /rewind card offer the same for recent turns. A copy inside this topic is /rewind fork. A branch is a snapshot of the conversation: from there the two live on their own.",
  'ctrl.branch.usage': "A branch has two forms. /branch <id> — a copy of that session here, this topic continues it. /branch new [n] — a copy of this session in a new topic, from n turns back (without a number, the whole thing). A copy inside this topic is /rewind fork.",
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
};
