// `/edit`: change lines in a file from the chat, with a diff and a button.
//
// Three steps, each one visible, because a write is the one thing here that
// cannot be taken back by reading the chat:
//
//   1. `/edit app.mjs:12-14` reads those lines and asks for the replacement.
//   2. The next plain message in that topic is the replacement text.
//   3. A diff appears with «Применить» and «Отмена». Nothing on disk changes
//      until the first is pressed — and when it is, the lines are re-read and
//      compared with what the diff showed, so an edit made by the agent between
//      the two messages answers "the file moved" instead of overwriting work.
//
// A dash (`-`) as the replacement text deletes the lines. That is the only way
// to say "nothing" in a chat that never sends an empty message.
import { readTextFile, resolveInRoot, writeTextFile } from '../lib/file-fence.mjs';
import { t } from '../core/i18n.mjs';
import { saveState as saveStateNow, state as liveState } from '../core/state.mjs';
import { ownRoot } from './cmd-files.mjs';

/** How many context lines the diff shows around the changed block. */
export const CONTEXT = 3;

/** `/edit app.mjs`, `app.mjs:12`, `app.mjs:12-14`, `app.mjs 12-14`. */
export function parseTarget(arg) {
  const raw = String(arg || '').trim();
  if (!raw) return { error: 'usage' };
  const m = /^(.*?)(?::(\d+)(?:\s*-\s*(\d+))?|\s+(\d+)(?:\s*-\s*(\d+))?)$/.exec(raw);
  if (!m) return { file: raw, error: 'lines' };
  const file = m[1].trim();
  if (!file) return { error: 'usage' };
  const from = Number(m[2] || m[4]);
  const to = Number(m[3] || m[5] || from);
  if (!from || to < from) return { file, error: 'range' };
  return { file, from, to };
}

/**
 * Split a file into editable lines, keeping the trailing-newline fact.
 *
 * `"a\nb\n"` is two lines, not three: the last empty element is the newline
 * itself, and counting it made `the file has 3 lines` for a two-line file.
 */
export function splitLines(text) {
  const norm = String(text).replace(/\r\n/g, '\n');
  const trailing = norm.endsWith('\n');
  const lines = (trailing ? norm.slice(0, -1) : norm).split('\n');
  return { lines, trailing };
}

/** The numbered block the person asked to edit, as one message. */
function blockCard(rel, from, lines, lang) {
  const rows = lines.map((line, n) => `${String(from + n).padStart(4)} ${line}`);
  return [
    t(lang, 'ctrl.edit.head', { path: rel, from, to: from + lines.length - 1 }),
    '```',
    ...rows,
    '```',
    '',
    t(lang, 'ctrl.edit.ask'),
  ].join('\n');
}

/** The diff, as a card: what the lines were, what they become. */
export function diffCard(rel, from, before, after, lang) {
  const rows = [
    ...before.map((line) => `- ${line}`),
    ...after.map((line) => `+ ${line}`),
  ];
  const head = t(lang, 'ctrl.edit.preview', { path: rel, from, to: from + before.length - 1, remove: before.length, add: after.length });
  return {
    text: [head, '```diff', ...rows, '```'].join('\n'),
    keyboard: [[
      { text: t(lang, 'ctrl.edit.apply'), data: 'ed:a' },
      { text: t(lang, 'ctrl.edit.cancel'), data: 'ed:c' },
    ]],
    next: { kind: 'rows', rows },
  };
}

/** `/edit <file>:<from>[-<to>]` — show the lines and wait for the replacement. */
export async function handleEditCommands(ctx) {
  if (ctx.command !== '/edit') return false;
  const { key, lang, reply } = ctx;
  const st = ctx.state || liveState;
  const parsed = parseTarget(ctx.arg);
  if (parsed.error) {
    await reply(t(lang, `ctrl.edit.${parsed.error}`));
    return true;
  }
  const root = ownRoot(st, key);
  if (!root) {
    await reply(t(lang, 'ctrl.find.empty'));
    return true;
  }
  const fenced = resolveInRoot(root, parsed.file);
  if (fenced.refusal) {
    await reply(t(lang, `ctrl.find.${fenced.refusal}`, { root }));
    return true;
  }
  if (fenced.dir) {
    await reply(t(lang, 'ctrl.find.file.dir'));
    return true;
  }
  const read = readTextFile(fenced.path);
  if (read.refusal) {
    await reply(t(lang, `ctrl.find.file.${read.refusal}`));
    return true;
  }
  const { lines } = splitLines(read.text);
  if (parsed.to > lines.length) {
    await reply(t(lang, 'ctrl.edit.range', { lines: lines.length }));
    return true;
  }
  st.edit = st.edit || {};
  st.edit[key] = { root, file: parsed.file, from: parsed.from, to: parsed.to, before: lines.slice(parsed.from - 1, parsed.to), step: 'text', at: Date.now() };
  (ctx.saveState || saveStateNow)();
  await reply(blockCard(parsed.file, parsed.from, st.edit[key].before, lang));
  return true;
}

/**
 * The replacement text, if this topic is in the middle of an edit.
 *
 * Called from the message handler before the text becomes a turn: during an
 * edit the next message is the new content, not a prompt for the agent. It
 * answers "was this mine" so the caller knows whether to start a turn.
 */
export async function takeEditText(ctx) {
  const { key, lang, reply } = ctx;
  const st = ctx.state || liveState;
  const cur = st.edit?.[key];
  if (!cur || cur.step !== 'text') return false;
  const text = String(ctx.text || '').replace(/\r\n/g, '\n');
  // A dash is the only way to send "no lines at all" through a chat.
  const after = text.trim() === '-' ? [] : text.replace(/\n$/, '').split('\n');
  const card = diffCard(cur.file, cur.from, cur.before, after, lang);
  st.edit[key] = { ...cur, step: 'confirm', after, at: Date.now() };
  (ctx.saveState || saveStateNow)();
  await reply(card.text, { keyboard: card.keyboard });
  return true;
}

/**
 * Pressed «Применить»: write the lines the diff showed, if the file still has
 * the lines the diff showed.
 */
export async function applyEdit(ctx) {
  const { key, lang } = ctx;
  const st = ctx.state || liveState;
  const cur = st.edit?.[key];
  if (!cur || cur.step !== 'confirm') {
    await ctx.answer(t(lang, 'ctrl.edit.stale'));
    return true;
  }
  const fenced = resolveInRoot(cur.root, cur.file);
  if (fenced.refusal) {
    await ctx.answer(t(lang, `ctrl.find.${fenced.refusal}`, { root: cur.root }));
    return true;
  }
  const read = readTextFile(fenced.path);
  if (read.refusal) {
    await ctx.answer(t(lang, `ctrl.find.file.${read.refusal}`));
    return true;
  }
  const { lines, trailing } = splitLines(read.text);
  const now = lines.slice(cur.from - 1, cur.to);
  // The file moved on since the diff: the agent may have edited it, or a turn
  // is running. Overwriting that would lose work the person never saw.
  if (now.join('\n') !== cur.before.join('\n')) {
    delete st.edit[key];
    (ctx.saveState || saveStateNow)();
    await ctx.answer(t(lang, 'ctrl.edit.changed'));
    return true;
  }
  const next = [...lines.slice(0, cur.from - 1), ...cur.after, ...lines.slice(cur.to)];
  // Keep the file ending the way it ended: a missing final newline is how the
  // project's own linters mark a file as unedited, and adding one would show up
  // as a change the person never asked for.
  const body = trailing && next.length ? `${next.join('\n')}\n` : next.join('\n');
  const written = writeTextFile(fenced.path, body);
  if (written.refusal) {
    await ctx.answer(t(lang, `ctrl.edit.write.${written.refusal}`));
    return true;
  }
  delete st.edit[key];
  (ctx.saveState || saveStateNow)();
  await ctx.reply(t(lang, 'ctrl.edit.applied', { path: cur.file, from: cur.from, to: cur.to }));
  return true;
}

/** Pressed «Отмена»: forget the pending edit, touch nothing. */
export async function cancelEdit(ctx) {
  const st = ctx.state || liveState;
  delete st.edit?.[ctx.key];
  (ctx.saveState || saveStateNow)();
  await ctx.reply(t(ctx.lang, 'ctrl.edit.canceled'));
  return true;
}