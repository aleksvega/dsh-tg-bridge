// Writing one MCP server into a profile, and taking it out again.
//
// The file belongs to the host: `cordis.patch.yml` is a YAML list of `- insert:`
// blocks, and the MCP entry is one item inside a block. Adding is an append to
// that list; removing is a slice. Neither is allowed to disturb a neighbour, so
// the writer works in text, re-parses the result, and refuses when the shape it
// expected is not the shape it found.
//
// The mark `# added from the chat` is what makes removal safe: it is a comment
// line the writer leaves above its own entry, so `withMcpServer` can tell its
// work from a server somebody configured by hand and `withoutMcpServer` can
// refuse to delete anything else.
import { writeFileSync } from 'node:fs';
import { patchPath, read } from './models.mjs';
import { MCP_PLUGIN, parseMcpServers } from './mcp-config.mjs';

/** The line that marks an entry as the chat's own work. */
export const CHAT_MARK = '# added from the chat';

/** The YAML block the writer would insert, as text, indented like its neighbours. */
export function mcpBlock(name, url, { indent = 4 } = {}) {
  const pad = ' '.repeat(indent);
  return [
    `${pad}- id: mcp-${name}`,
    `${pad}  name: '${MCP_PLUGIN}'`,
    `${pad}  config:`,
    `${pad}    transport: streamable-http`,
    `${pad}    serverName: ${name}`,
    `${pad}    url: ${url}`,
  ].join('\n');
}

/**
 * The patch with one MCP server appended, plus the text it appended.
 *
 * Returns `{ ok, text, yaml }` and writes nothing: the caller shows `yaml`, and
 * the press that confirms it calls back with `expected` so the write is refused
 * if the file moved between the preview and the press.
 */
export function withMcpServer({ profile, name, url, expected }) {
  const path = patchPath(profile);
  const source = read(path);
  if (!source.trim()) return { ok: false, why: 'noProfile' };
  if (typeof expected === 'string' && expected !== source) return { ok: false, why: 'changed' };
  // Re-parsing first is the guard that keeps a hand-edited, broken file from
  // being extended with a second shape of mistake.
  const before = parseMcpServers(source);
  if (before.some((one) => one.server.toLowerCase() === String(name).toLowerCase())) {
    return { ok: false, why: 'duplicate' };
  }
  const block = mcpBlock(name, url);
  const yaml = `${CHAT_MARK}\n- insert:\n${block}`;
  const text = `${source.replace(/\s*$/, '')}\n${yaml}\n`;
  const after = parseMcpServers(text);
  // The proof that the write is well-formed is the parser finding the new entry
  // and every old one — not a regex that agreed with itself.
  if (after.length !== before.length + 1) return { ok: false, why: 'malformed' };
  if (!after.some((one) => one.server === name)) return { ok: false, why: 'malformed' };
  return { ok: true, text, yaml, path, from: source };
}

/** Cut one chat-added server out of the patch. */
export function withoutMcpServer({ profile, id }) {
  const path = patchPath(profile);
  const source = read(path);
  if (!source.trim()) return { ok: false, why: 'noProfile' };
  const servers = parseMcpServers(source);
  const target = servers.find((one) => one.id === id);
  if (!target) return { ok: false, why: 'gone' };
  if (!target.chatAdded) return { ok: false, why: 'foreign' };
  const lines = source.split(/\r?\n/);
  // Walk up from the entry to the start of the block that holds it: its `- insert:`
  // wrapper and, above that, the mark this writer left. Anything else ends the walk,
  // so a neighbour's line is never part of the cut.
  let cutFrom = target.start;
  for (let i = target.start - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*-\s+insert:\s*$/.test(line) || line.trim() === CHAT_MARK) {
      cutFrom = i;
      continue;
    }
    break;
  }
  const kept = [...lines.slice(0, cutFrom), ...lines.slice(target.end)];
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n');
  const after = parseMcpServers(text);
  if (after.length !== servers.length - 1) return { ok: false, why: 'malformed' };
  if (after.some((one) => one.id === id)) return { ok: false, why: 'malformed' };
  return { ok: true, text, path };
}

/** Write the accepted text. Only the caller that previewed it reaches here. */
export function commitMcp(write) {
  if (!write?.ok) return write;
  writeFileSync(write.path, write.text, 'utf8');
  return write;
}
