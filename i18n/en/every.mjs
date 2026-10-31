// `/every`: the words of the daily schedule — created, listed, removed, refused.
//
// A table of its own, like `diff.mjs` and `endpoint.mjs`: the command has a
// surface of its own (four verbs and five refusals) and its sentences have to
// agree in three languages. It also keeps `ctrl.mjs` under the 500-line
// ceiling, which adding thirteen strings to it would have broken.
export default {
  'ctrl.help.about.every': 'One repeating schedule: /every 09:00 text runs that text as a normal turn every day at that time. /every list shows this chat\'s schedules, /every rm 2 removes one.',
  'ctrl.every.usage': 'Usage: /every 09:00 text — repeats every day at that time · /every list · /every rm 1.',
  'ctrl.every.title': '🔁 Every day',
  'ctrl.every.empty': 'No schedules in this chat yet.',
  'ctrl.every.line': '{n}. {when} · every day{topic} — {text}',
  'ctrl.every.topicLabel': 'topic {thread}',
  'ctrl.every.hint': 'Add: /every 09:00 text · remove: /every rm 1 · the text arrives as a normal message, so the agent does the work.',
  'ctrl.every.added': '🔁 Every day at {when} — {text}',
  'ctrl.every.rmDone': 'Removed schedule {n} ({text}).',
  'ctrl.every.rmUsage': 'Which one? /every rm <number from the list>.',
  'ctrl.every.tooMany': 'That is {max} schedules in this chat already — remove one first.',
  'ctrl.every.time': 'I cannot read the time. Use 09:00 — a daily time on this machine\'s clock.',
  'ctrl.every.text': 'The time is there, the text is missing: /every 09:00 check the build.',
};
