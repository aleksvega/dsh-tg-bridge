// What the profile already says about MCP servers, read without a host.
//
// The install runs `mcp-exa` today and the chat shows nothing about it, so a
// person cannot tell whether the web tools exist, which ones, or where they come
// from. The desktop app draws that from live plugin state; the bridge has no
// plugin channel, so it reads the one file that decides what the host loads —
// the profile's own `cordis.patch.yml`.
//
// Reading the file rather than a second copy is the whole point: a card built
// from a cached list drifts the moment somebody edits YAML, and then the card is
// confidently wrong about a machine it can see.
import { existsSync } from 'node:fs';
import { patchPath, read } from './models.mjs';

/** The plugin package that makes an entry an MCP server. */
export const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client';

/** Names a person can say and a callback can carry. */
const SERVER_NAME = /^[a-z][a-z0-9_-]{1,40}$/i;

/**
 * Hide the parts of a value that grant access, and keep the parts that identify.
 *
 * A URL is shown with its host and path because that is what tells two servers
 * apart; its query values are not. The same rule as `/logs`: an access token in a
 * query string, a header value and an env value are all `***`.
 */
export function redactSecret(value) {
  const text = String(value ?? '');
  if (!text) return '';
  // `?key=abc` and `&token=abc`: the parameter stays, its value does not. A bare
  // `?abc` (no `=`) is a value too, so it goes whole.
  return text
    .replace(/([?&][^=&\s]+)=([^&\s]*)/g, '$1=***')
    .replace(/([?&])([^=&\s]{8,})(?=&|$)/g, '$1***');
}

/**
 * The URL a person may read: secrets gone, everything else intact.
 *
 * Credentials in the userinfo part (`https://user:pass@host`) are the one shape
 * `redactSecret` cannot see, because there is no `=` to anchor on.
 */
export function safeUrl(url) {
  const text = String(url ?? '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return redactSecret(parsed.toString());
  } catch {
    return redactSecret(text);
  }
}

/** The lines directly above an entry that belong to its block, joined. */
function aboveMarker(lines, start) {
  const out = [];
  for (let i = start - 1; i >= 0 && out.length < 4; i -= 1) {
    const line = lines[i];
    // A blank line or the `- insert:` wrapper is part of this entry's block; the
    // first line of anything else ends the walk.
    if (!line.trim() || /^\s*-\s+insert:\s*$/.test(line)) {
      out.push(line);
      continue;
    }
    out.push(line);
    break;
  }
  return out.join('\n');
}

/** One `- id:` entry, as lines, with the index it starts at. */
function entrySpans(lines) {
  const spans = [];
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // An entry begins at `- id: ...` (the patch's list form) and ends at the next
    // entry or at a line shallower than the entry's own indent.
    const head = /^(\s*)-\s+id:\s*(\S+)\s*$/.exec(line);
    if (head) {
      if (start >= 0) spans.push({ start, end: i, indent: spans.indent });
      start = i;
      spans.indent = head[1].length;
      continue;
    }
    if (start < 0) continue;
    if (!line.trim()) {
      // A blank line ends the entry only if the next non-blank line is shallower
      // or another entry; keeping blanks inside keeps the slice readable.
      continue;
    }
    const indent = (/^\s*/).exec(line)[0].length;
    if (indent <= spans.indent) {
      spans.push({ start, end: i, indent: spans.indent });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ start, end: lines.length, indent: spans.indent });
  return spans.map((span) => ({ start: span.start, end: span.end, indent: span.indent }));
}

/** `config:` keys of an entry, shallow and typed as text. */
function configOf(block) {
  const out = {};
  let inConfig = false;
  let configIndent = 0;
  for (const line of block) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = (/^\s*/).exec(line)[0].length;
    const key = /^\s*([\w-]+):\s*(.*)$/.exec(line);
    if (!key) continue;
    if (key[1] === 'config' && key[2].trim() === '') {
      inConfig = true;
      configIndent = indent;
      continue;
    }
    if (inConfig && indent <= configIndent) {
      inConfig = false;
    }
    if (inConfig) out[key[1]] = key[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * The MCP servers a profile declares.
 *
 * @param {string} text the profile's `cordis.patch.yml`
 * @returns {Array<{id: string, server: string, transport: string, url: string,
 *   command: string, args: string[], chatAdded: boolean}>}
 */
export function parseMcpServers(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const servers = [];
  for (const span of entrySpans(lines)) {
    const block = lines.slice(span.start, span.end);
    const body = block.join('\n');
    if (!new RegExp(`^\\s*name:\\s*['"]?${MCP_PLUGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(body)) continue;
    const id = (/^\s*-\s+id:\s*(\S+)/.exec(block[0]) || [])[1] || '';
    const config = configOf(block);
    const server = config.serverName || id.replace(/^mcp-/, '');
    const args = [];
    let inArgs = false;
    for (const line of block) {
      if (/^\s*args:\s*$/.test(line)) {
        inArgs = true;
        continue;
      }
      if (inArgs) {
        const item = /^\s*-\s*(.+)$/.exec(line);
        if (item) args.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
        else if (line.trim()) inArgs = false;
      }
    }
    servers.push({
      id,
      server,
      transport: config.transport || 'stdio',
      url: safeUrl(config.url || ''),
      command: config.command || '',
      args,
      // The marker the writer leaves behind: a line the person never types. It
      // sits above the enclosing `- insert:` wrapper, so the lines just above the
      // entry are walked back until something decisive is found.
      chatAdded: /#\s*added from the chat/i.test(aboveMarker(lines, span.start)),
      start: span.start,
      end: span.end,
      indent: span.indent,
    });
  }
  return servers;
}

/** The servers of a profile, or a sentence when the profile is not there. */
export function mcpServers(profile) {
  const path = patchPath(profile);
  if (!existsSync(path)) return { ok: false, why: 'missingProfile', profile, path, servers: [] };
  const servers = parseMcpServers(read(path));
  return { ok: true, profile, path, servers };
}

/** Is this a name the card can show and a callback can carry? */
export function checkServerName(name) {
  const value = String(name ?? '').trim();
  if (!value) return { ok: false, why: 'empty' };
  if (!SERVER_NAME.test(value)) return { ok: false, why: 'badName' };
  return { ok: true, name: value };
}
