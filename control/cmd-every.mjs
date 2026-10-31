// `/every`: an instruction the bridge repeats on a wall clock.
//
// One group of the `/` surface. `control.mjs` owns the dispatch and this file
// owns the command; `work/schedules.mjs` owns the parsing, the claim and the
// synthetic message, so the command and the tick cannot disagree about when a
// row is due.
import { normalizeLang, t } from '../core/i18n.mjs';
import { MAX, chatOf, parseEvery } from '../work/schedules.mjs';
import { stampAt } from '../work/reminders.mjs';

export async function handleEveryCommands(ctx) {
  const { arg, reply, state, key, config, lang: rawLang } = ctx;
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const effective = ctx.effective || ctx.command;
  if (effective !== '/every') return false;

  const say = (text) => reply(text);
  const input = String(arg || '').trim();
  // Every schedule this chat owns, in every topic of it: `/every list` is asked
  // from one topic but answers for the chat, the cap below is per chat (like the
  // reminders' twenty), and a list that hid the other topics would let a person
  // fill the chat up while every answer said there was room. A row that fires in
  // another topic says which one.
  const mine = chatOf(state.schedules, ctx.chatId);
  const now = Date.now();

  if (!input) {
    say(t(lang, 'ctrl.every.usage'));
    return true;
  }

  const [verb = '', ...rest] = input.split(/\s+/);
  if (verb.toLowerCase() === 'list' && rest.length === 0) {
    if (mine.length === 0) {
      say([t(lang, 'ctrl.every.title'), t(lang, 'ctrl.every.empty'), t(lang, 'ctrl.every.hint')].join('\n'));
      return true;
    }
    const lines = [t(lang, 'ctrl.every.title')];
    mine.forEach((row, index) => {
      const thread = Number(row.threadId) || 0;
      lines.push(t(lang, 'ctrl.every.line', {
        n: index + 1,
        // The next run, not the one that just happened: that is the time a
        // person is checking when they open the list.
        when: stampAt(row.at, now),
        // Only a topic row needs the pointer; the chat where it was typed is
        // where the person already is.
        topic: thread > 0 ? ` · ${t(lang, 'ctrl.every.topicLabel', { thread })}` : '',
        text: row.text,
      }));
    });
    lines.push(t(lang, 'ctrl.every.hint'));
    say(lines.join('\n'));
    return true;
  }
  // `rm` is the only destructive verb, so it is also the only one that must not
  // be reachable by a typo in a schedule's text.
  if (/^(del|delete|rm)$/i.test(verb) && rest.length <= 1) {
    const index = Number.parseInt(rest[0] ?? '', 10);
    if (!Number.isInteger(index) || index < 1 || index > mine.length) {
      say(t(lang, 'ctrl.every.rmUsage'));
      return true;
    }
    const target = mine[index - 1];
    state.schedules = state.schedules.filter((row) => row.id !== target.id);
    ctx.saveState();
    say(t(lang, 'ctrl.every.rmDone', { n: index, text: target.text }));
    return true;
  }

  const parsed = parseEvery(input, now);
  // A malformed line is answered as a malformed line even when the list is full:
  // "you have too many" would hide the typo the person has to fix anyway.
  if (parsed.error === 'text') {
    say(t(lang, 'ctrl.every.text'));
    return true;
  }
  if (parsed.error) {
    say(t(lang, 'ctrl.every.time'));
    return true;
  }
  if (mine.length >= MAX) {
    say(t(lang, 'ctrl.every.tooMany', { max: MAX }));
    return true;
  }

  state.schedules = Array.isArray(state.schedules) ? state.schedules : [];
  state.schedules.push({
    // The id travels in log lines and in `rm`; the counter keeps two schedules
    // created in the same millisecond apart.
    id: `s${now.toString(36)}${state.schedules.length}`,
    chatId: String(ctx.chatId ?? ''),
    threadId: ctx.threadId || 0,
    // The session key is what the tick hands to the queue, but the bound project
    // can change later — the topic is the durable fact, the key is a hint.
    key,
    at: parsed.at,
    hh: parsed.hh,
    mm: parsed.mm,
    text: parsed.text,
    lang,
    madeAt: now,
  });
  ctx.saveState();
  const clock = `${String(parsed.hh).padStart(2, '0')}:${String(parsed.mm).padStart(2, '0')}`;
  say(t(lang, 'ctrl.every.added', { when: clock, text: parsed.text }));
  return true;
}