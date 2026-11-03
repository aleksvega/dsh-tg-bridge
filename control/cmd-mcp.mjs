// `/mcp` — the MCP servers this topic's profile runs, and one server at a time.
//
// The install already carries `mcp-exa`; the chat showed nothing about it, so a
// person could not tell that `web_search_exa` and `web_fetch_exa` exist at all.
// The card reads the profile's own `cordis.patch.yml` (see `mcp-config.mjs`) so
// it cannot disagree with what the host loads.
//
// What this command refuses is the point of it. It writes YAML by hand-parsing a
// file the host also owns, so every write is previewed, re-parsed before it
// lands, and marked with a line the person never types; a removal only ever
// touches an entry carrying that mark. No tool is executed from here — the card
// copies a tool name into the chat and stops.
import { t } from '../core/i18n.mjs';
import { mcpServers, checkServerName } from './mcp-config.mjs';
import { withMcpServer, withoutMcpServer, commitMcp } from './mcp-write.mjs';
import { listCard, serverCard } from '../chat/mcp-press.mjs';
import { saveState } from '../core/state.mjs';

/** The YAML an add would insert, shown before anything is written. */
function previewText(lang, name, yaml) {
  return [
    t(lang, 'ctrl.mcp.addHead', { server: name }),
    '',
    '```yaml',
    yaml.trimEnd(),
    '```',
    '',
    t(lang, 'ctrl.mcp.addBody'),
  ].join('\n');
}

export async function handleMcpCommands(ctx) {
  const { effective, arg, lang, reply, log, profile, config, key, state: st } = ctx;
  if (effective !== '/mcp') return false;
  const activeProfile = profile || config?.profile || 'headless';
  const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
  const verb = (parts[0] || '').toLowerCase();
  const found = mcpServers(activeProfile);

  if (!verb) {
    const card = listCard(lang, activeProfile);
    await reply(card.text, { keyboard: card.keyboard.length ? card.keyboard : undefined });
    return true;
  }

  if (verb === 'add') {
    if (parts.length < 3) {
      await reply(t(lang, 'ctrl.mcp.addUsage'));
      return true;
    }
    const name = checkServerName(parts[1]);
    if (!name.ok) {
      await reply(t(lang, 'ctrl.mcp.badName', { name: parts[1] || '' }));
      return true;
    }
    const url = String(parts[2] || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      await reply(t(lang, 'ctrl.mcp.badUrl', { url }));
      return true;
    }
    if (!found.ok) {
      await reply(t(lang, 'ctrl.mcp.noProfile', { profile: activeProfile }));
      return true;
    }
    // A duplicate is refused before the preview: writing a second `exa` would give
    // the host two servers with one name and no way to tell which answered.
    const twin = found.servers.find((one) => one.server.toLowerCase() === name.name.toLowerCase());
    if (twin) {
      await reply(t(lang, 'ctrl.mcp.duplicate', { server: twin.server, id: twin.id }));
      return true;
    }
    const built = withMcpServer({ profile: activeProfile, name: name.name, url });
    if (!built.ok) {
      await reply(t(lang, `ctrl.mcp.why.${built.why}`, { profile: activeProfile }));
      return true;
    }
    // The preview is held in state, not in memory: a press may arrive after a
    // restart, and a write that lost its preview must answer "stale" rather than
    // append a block nobody saw.
    st.mcpPending = st.mcpPending || {};
    st.mcpPending[key] = { name: name.name, url, text: built.text, from: built.from, at: Date.now() };
    saveState();
    await reply(previewText(lang, name.name, built.yaml), {
      keyboard: [
        [{ text: t(lang, 'ctrl.mcp.addButton'), data: 'mc:add' }],
        [{ text: t(lang, 'ctrl.mcp.cancelButton'), data: 'mc:cancel' }],
      ],
    });
    return true;
  }

  if (verb === 'rm' || verb === 'remove') {
    if (parts.length < 2) {
      await reply(t(lang, 'ctrl.mcp.rmUsage'));
      return true;
    }
    const wanted = parts[1];
    const target = found.servers.find((one) => one.server === wanted || one.id === wanted);
    if (!target) {
      await reply(t(lang, 'ctrl.mcp.gone', { profile: activeProfile }));
      return true;
    }
    // The house rule for anything the bridge did not create: point at the file
    // instead of deleting configuration somebody else wrote.
    if (!target.chatAdded) {
      await reply(t(lang, 'ctrl.mcp.foreign', { server: target.server, profile: activeProfile }));
      return true;
    }
    const cut = withoutMcpServer({ profile: activeProfile, id: target.id });
    if (!cut.ok) {
      await reply(t(lang, `ctrl.mcp.why.${cut.why}`, { profile: activeProfile }));
      return true;
    }
    commitMcp(cut);
    log(`mcp rm ${target.server} (${target.id}) in ${activeProfile}`);
    await reply(t(lang, 'ctrl.mcp.removed', { server: target.server, profile: activeProfile }));
    return true;
  }

  const one = serverCard(lang, activeProfile, parts[0]);
  await reply(one.text, { keyboard: one.keyboard.length ? one.keyboard : undefined });
  return true;
}
