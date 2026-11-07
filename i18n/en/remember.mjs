// EN strings for long-term memory (/remember).
//
// A table of its own for the same reason `branch.mjs` is: one feature, one
// file, one diff, and `ctrl.mjs` stays off the 500-line ceiling.
export default {
  'ctrl.help.about.remember': "Long-term memory: /remember <fact> appends a dated line to the Learned section of AGENTS.md — the file the agent reads before every request. /remember shows the section, /remember tidy starts a turn that prunes it itself, /remember forget <word> or forget all erases. Memory you can see all of.",
  'ctrl.remember.saved': "Remembered ({count} notes held).",
  'ctrl.remember.dropped': "Remembered ({count} notes held) — the memory is full, {dropped} oldest notes were pushed out. /remember tidy will compact the list.",
  'ctrl.remember.list': "Memory — {n} notes, latest:\n{list}",
  'ctrl.remember.empty': "Memory is empty. /remember <fact> — and a dated line lands in AGENTS.md, where the agent looks before every request.",
  'ctrl.remember.tidy': "Started a turn: the agent will reread its memory, merge duplicates and drop what is stale. The report arrives as a message.",
  'ctrl.remember.task': "Tidy up your own memory. Open AGENTS.md inside DSH_HOME, find the section «## Learned (DSH memory)»: reread every line, merge duplicates and repetition, drop what is stale or will never matter again, keep the dates. Keep the section at 60 lines or fewer and leave the rest of the file alone. Edit the file with your write tools, then answer with one list: what you removed, what you kept, and why.",
  'ctrl.remember.forgot': "Erased {n} note(s), {count} left.",
  'ctrl.remember.forgotAll': "The memory section is clear — the rest of the file is untouched.",
  'ctrl.remember.notFound': "The word {word} was not in the memory — nothing erased.",
  'ctrl.remember.noTurn': "A turn cannot be started from this command here — tidy the memory by hand with /edit.",
};
