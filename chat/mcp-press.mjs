// A press on an `/mcp` card: open one server, confirm an add, cancel it.
//
// Kept out of the callback router for the same reason `/find` and `/ls` are:
// this is the only place a press writes a profile file, and the preview → confirm
// handshake belongs next to the writer it guards.
//
// Every branch re-reads the profile instead of trusting the card. Between the
// preview and the press somebody may have edited the file on the machine, and a
// card that still wrote would silently overwrite that edit.
import { t } from '../core/i18n.mjs';
import { mcpServers } from '../control/mcp-config.mjs';
import { commitMcp, withMcpServer, withoutMcpServer } from '../control/mcp-write.mjs';
import { inlineKeyboard, tg } from './telegram.mjs';
import { config, state } from '../core/state.mjs';

/** The card as text plus rows, so a press can redraw the same message. */
export function listCard(lang, activeProfile) {
  const found = mcpServers(activeProfile);
  if (!found.ok) return { text: t(lang, 'ctrl.mcp.noProfile', { profile: activeProfile }), keyboard: [] };
  if (found.servers.length === 0) return { text: t(lang, 'ctrl.mcp.empty', { profile: activeProfile }), keyboard: [] };
  const lines = [t(lang, 'ctrl.mcp.listHead', { profile: activeProfile, n: found.servers.length }), ''];
  for (const server of found.servers) {
    lines.push(`• ${server.server} · ${server.transport}${server.chatAdded ? t(lang, 'ctrl.mcp.chatMark') : ''}`);
    lines.push(`  ${server.url || [server.command, ...server.args].filter(Boolean).join(' ') || t(lang, 'ctrl.mcp.noAddress')}`);
  }
  lines.push('', t(lang, 'ctrl.mcp.listHint'));
  const keyboard = found.servers.slice(0, 20).map((server) => [{ text: server.server, data: `mc:srv:${server.id.slice(0, 40)}` }]);
  return { text: lines.join('\n'), keyboard };
}

/** One server by row id, with secrets already redacted by the parser. */
export function serverCard(lang, activeProfile, id) {
  const found = mcpServers(activeProfile);
  const server = found.servers.find((one) => one.id === id || one.server === id);
  if (!server) return { text: t(lang, 'ctrl.mcp.gone', { profile: activeProfile }), keyboard: [] };
  const lines = [t(lang, 'ctrl.mcp.oneHead', { server: server.server }), ''];
  lines.push(t(lang, 'ctrl.mcp.rowTransport', { transport: server.transport }));
  if (server.url) lines.push(t(lang, 'ctrl.mcp.rowUrl', { url: server.url }));
  if (server.command) {
    lines.push(t(lang, 'ctrl.mcp.rowCommand', { command: [server.command, ...server.args].filter(Boolean).join(' ') }));
  }
  lines.push(t(lang, 'ctrl.mcp.rowId', { id: server.id }));
  lines.push(server.chatAdded ? t(lang, 'ctrl.mcp.rowChatAdded') : t(lang, 'ctrl.mcp.rowHandMade'));
  lines.push('', t(lang, 'ctrl.mcp.toolsHead'), t(lang, 'ctrl.mcp.toolsUnknown'));
  lines.push('', t(lang, 'ctrl.mcp.restartNote'));
  return { text: lines.join('\n'), keyboard: [[{ text: t(lang, 'ctrl.mcp.back'), data: 'mc:list' }]] };
}

/** The pending add a `/mcp add` preview left in state, or nothing. */
const held = (key) => state.mcpPending?.[key];

/**
 * Handle one `mc:` press.
 *
 * @returns {Promise<boolean>} true when the press was this module's to answer.
 */
export async function handleMcpPress({ data, key, lang, chatId, threadId, messageId, answer }) {
  const activeProfile = config?.profile || 'headless';
  const body = String(data || '');
  if (!body.startsWith('mc:')) return false;
  const redraw = (card) => tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: card.text,
    ...(card.keyboard?.length ? { reply_markup: { inline_keyboard: inlineKeyboard(card.keyboard) } } : {}),
  }).catch(() => {});
  const say = async (line, card) => {
    if (card) await redraw(card);
    else {
      await tg('sendMessage', {
        chat_id: chatId,
        ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        text: line,
      }).catch(() => {});
    }
    await answer(line.slice(0, 190));
  };

  if (body === 'mc:list') {
    await say(t(lang, 'ctrl.mcp.listHead', { profile: activeProfile, n: mcpServers(activeProfile).servers.length }), listCard(lang, activeProfile));
    return true;
  }

  if (body.startsWith('mc:srv:')) {
    const id = body.slice('mc:srv:'.length);
    const card = serverCard(lang, activeProfile, id);
    await redraw(card);
    // A card drawn from a profile that changed says "gone" rather than showing a
    // heading for a server that is not there any more.
    await answer(t(lang, 'ctrl.mcp.oneHead', { server: id.replace(/^mcp-/, '') }));
    if (card.text === t(lang, 'ctrl.mcp.gone', { profile: activeProfile })) await say(card.text);
    return true;
  }

  if (body === 'mc:cancel') {
    if (state.mcpPending?.[key]) delete state.mcpPending[key];
    await say(t(lang, 'ctrl.mcp.cancelled'));
    return true;
  }

  if (body === 'mc:add') {
    const pending = held(key);
    if (!pending) {
      await say(t(lang, 'ctrl.mcp.stale'));
      return true;
    }
    delete state.mcpPending[key];
    const written = withMcpServer({
      profile: activeProfile,
      name: pending.name,
      url: pending.url,
      // The bytes the person saw, carried through so the write cannot land on a
      // file that changed after the preview.
      expected: pending.from,
    });
    if (!written.ok) {
      await say(t(lang, `ctrl.mcp.why.${written.why}`, { profile: activeProfile }));
      return true;
    }
    commitMcp(written);
    await say(t(lang, 'ctrl.mcp.added', { server: pending.name, profile: activeProfile }));
    return true;
  }

  if (body.startsWith('mc:rm:')) {
    const id = body.slice('mc:rm:'.length);
    const cut = withoutMcpServer({ profile: activeProfile, id });
    if (!cut.ok) {
      await say(t(lang, `ctrl.mcp.why.${cut.why}`, { profile: activeProfile }));
      return true;
    }
    commitMcp(cut);
    await say(t(lang, 'ctrl.mcp.removed', { server: id.replace(/^mcp-/, ''), profile: activeProfile }), listCard(lang, activeProfile));
    return true;
  }

  if (body.startsWith('mc:tool:')) {
    // A tool row copies the name and runs nothing: invoking a tool from a card
    // would be a second, silent way to let the machine act on the chat.
    await say(t(lang, 'ctrl.mcp.toolCopied', { tool: body.slice('mc:tool:'.length) }));
    return true;
  }
  return false;
}
