// `/ls` and `/view`: see what the topic folder holds, from the phone.
//
// `/find` answers "where is this line", but a person who only wants to look
// around had no way to. `/ls` lists one folder as buttons, `/view` opens a file
// with line numbers, and both reuse the same fence and the same paged window the
// search results already use, so the rules learned once still hold: nothing
// outside the topic folder, nothing binary, nothing over 512 KB.
import { resolveInRoot } from '../lib/file-fence.mjs';
import { t } from '../core/i18n.mjs';
import { previewWindow } from '../chat/file-preview.mjs';
import { listDir, listingCard } from '../chat/file-listing.mjs';
import { saveState as saveStateNow, state as liveState } from '../core/state.mjs';

/** The folder this topic itself is bound to — no install-wide fallback. */
export function ownRoot(st, key) {
  return (st?.cwd && st.cwd[key]) || '';
}

/** Open one file with line numbers and remember the window for the "more" button. */
export async function openFile(ctx, root, file, line = 1) {
  const { key, lang, reply } = ctx;
  const view = previewWindow({ root, file, line, lang });
  if (view.refusal) {
    await reply(t(lang, `ctrl.find.file.${view.refusal}`));
    return true;
  }
  const st = ctx.state || liveState;
  st.preview = st.preview || {};
  st.preview[key] = { root, file, line, start: 0 };
  (ctx.saveState || saveStateNow)();
  await reply(view.text, { keyboard: view.keyboard });
  return true;
}

/** One `/ls` or `/view` command, or false when it is neither. */
export async function handleFileCommands(ctx) {
  const { effective, arg, state: st, key, lang, reply } = ctx;
  if (effective !== '/ls' && effective !== '/view') return false;
  const root = ownRoot(st, key);
  if (!root) {
    await reply(t(lang, 'ctrl.find.empty'));
    return true;
  }
  if (effective === '/view') {
    const asked = String(arg || '').trim();
    if (!asked) {
      await reply(t(lang, 'ctrl.view.usage'));
      return true;
    }
    // `file:412` and `file 412` both name a line: a path copied out of another
    // app arrives with the colon, and a path typed on a phone arrives with a
    // space, so both have to work.
    const cut = asked.match(/^(.*?):(\d+)$/);
    const spaced = cut ? null : asked.match(/^(.*?)\s+(\d+)$/);
    const file = (cut ? cut[1] : (spaced ? spaced[1] : asked)).trim();
    const line = Math.max(1, Number((cut || spaced || [])[2]) || 1);
    const fenced = resolveInRoot(root, file);
    if (fenced.refusal) {
      await reply(t(lang, `ctrl.find.${fenced.refusal}`, { root }));
      return true;
    }
    return openFile(ctx, root, file, line);
  }
  const rel = String(arg || '').trim();
  const result = listDir(root, rel);
  if (result.refusal === 'notDir') {
    // A file named where a folder was expected: reading it is what they meant.
    return openFile(ctx, root, rel, 1);
  }
  if (result.refusal) {
    await reply(t(lang, `ctrl.find.${result.refusal}`, { root }));
    return true;
  }
  const st2 = ctx.state || liveState;
  st2.listing = st2.listing || {};
  st2.listing[key] = { root, dir: rel || '.', rows: result.rows, at: Date.now() };
  (ctx.saveState || saveStateNow)();
  const card = listingCard(rel, result, lang);
  await reply(card.text, { keyboard: card.keyboard });
  return true;
}
