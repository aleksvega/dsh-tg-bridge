// Reading a profile's delegation setup out of its Cordis patch.
//
// A profile patch is YAML, and this module deliberately does not parse YAML: it
// reads the few keys the bridge reports on, from the rows that declare them.
// A row is `- id: <row>` with `name:` and `config:` beside it, so the row ends
// where the indent drops back to the dash, and the config's own keys are the
// shallowest lines inside it.
//
// This is its own module with tests because a wrong indent assumption turns
// "the subagent model is X" into a confident lie, and a person setting a cost
// budget has to be able to trust that line.

/** Indent width of a line (tabs count as one column, as YAML forbids them). */
const indentOf = (line) => /^\s*/.exec(line)[0].length;

/** Strip one layer of matching quotes. */
const unquote = (value) => value.replace(/^['"]|['"]$/g, '');

/**
 * The row that owns the `name:` line at `at`: its dash line indent and the
 * lines below it, up to the next row.
 * @param {string[]} lines patch lines
 * @param {number} at index of the `name:` line
 * @returns {{ indent: number, body: string[] }}
 */
function rowAt(lines, at) {
  let indent = Math.max(0, indentOf(lines[at]) - 2);
  for (let i = at - 1; i >= 0 && i >= at - 3; i -= 1) {
    if (/^\s*-\s*(id|name):/.test(lines[i])) {
      indent = indentOf(lines[i]);
      break;
    }
  }
  const body = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (indentOf(line) <= indent) break;
    body.push(line);
  }
  return { indent, body };
}

/**
 * The keys of a nested block (`config:`, `agentOptions:`), read as a flat map of
 * its shallowest keys. Deeper values belong to the nested maps this module reads
 * separately, so they never override a top-level key.
 * @param {string[]} body lines below the block's key
 * @param {number} base indent of the block's key line
 */
function blockKeys(body, base) {
  const rows = body.filter((line) => indentOf(line) > base && !/^\s*-\s/.test(line));
  if (rows.length === 0) return {};
  const depth = Math.min(...rows.map(indentOf));
  const out = {};
  for (const line of rows) {
    if (indentOf(line) !== depth) continue;
    const match = /^\s*([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    if (match[2]) out[match[1]] = unquote(match[2]);
    else out[match[1]] = true;
  }
  return out;
}

/** Index of the last `key:` line at a depth shallower than `body`'s keys. */
function blockStart(body, key) {
  for (let i = body.length - 1; i >= 0; i -= 1) {
    if (new RegExp(`^\\s*${key}:\\s*$`).test(body[i])) return i;
  }
  return -1;
}

/** A `toolFilter:` allow/deny list, counted rather than enumerated. */
function toolFilterOf(body) {
  const at = blockStart(body, 'toolFilter');
  if (at < 0) return { allow: 0, deny: 0 };
  const base = indentOf(body[at]);
  const out = { allow: 0, deny: 0 };
  let list = '';
  for (let i = at + 1; i < body.length; i += 1) {
    const line = body[i];
    if (!line.trim()) continue;
    if (indentOf(line) <= base) break;
    const key = /^\s*(allow|deny):\s*$/.exec(line);
    if (key) {
      list = key[1];
      continue;
    }
    if (list && /^\s*-\s*\S/.test(line)) out[list] += 1;
  }
  return out;
}

/**
 * Every `dsh-tool-subagent` row of a patch: one per delegation tool the model
 * can actually see (`subagent`, `subagent_fork`, …).
 * @param {string} text profile patch
 */
export function parseSubagentRows(text) {
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*name:\s*['"]?@deepseek-ai\/dsh-tool-subagent['"]?\s*$/.test(lines[i])) continue;
    const { body } = rowAt(lines, i);
    const configAt = blockStart(body, 'config');
    const config = configAt >= 0 ? blockKeys(body.slice(configAt + 1), indentOf(body[configAt])) : {};
    const optionsAt = blockStart(body, 'agentOptions');
    const options = optionsAt >= 0 ? blockKeys(body.slice(optionsAt + 1), indentOf(body[optionsAt])) : {};
    const filter = toolFilterOf(body);
    // The row id sits on the line above `name:`; a patch can also declare the
    // pair inline, and then there is nothing to name the row by.
    const idLine = i > 0 ? /^\s*-\s*id:\s*(\S+)\s*$/.exec(lines[i - 1]) : null;
    rows.push({
      id: idLine ? idLine[1] : '',
      toolName: config.toolName || 'subagent',
      provider: config.provider || 'spawn',
      model: options.model || '',
      modelProvider: options.provider || '',
      reasoningEffort: options.reasoningEffort || '',
      maxTokens: options.maxTokens || '',
      maxDepth: typeof config.maxDepth === 'string' ? config.maxDepth : '',
      backgroundMode: config.backgroundMode || 'one-shot',
      background: config.enableRunInBackground !== 'false',
      persona: body.some((line) => /^\s*persona:\s*\S/.test(line)),
      toolAllow: filter.allow,
      toolDeny: filter.deny,
    });
  }
  return rows;
}

/**
 * The `model-selection-settings` row: which routes a delegated turn may pick.
 * Absent means the child simply inherits the tool's own `agentOptions`.
 * @param {string} text profile patch
 */
export function parseModelSelection(text) {
  const lines = String(text || '').split(/\r?\n/);
  const at = lines.findIndex((line) => /^\s*name:\s*['"]?@deepseek-ai\/dsh-tool-subagent\/model-selection-settings['"]?\s*$/.test(line));
  if (at < 0) return null;
  const { body } = rowAt(lines, at);
  const configAt = blockStart(body, 'config');
  const config = configAt >= 0 ? blockKeys(body.slice(configAt + 1), indentOf(body[configAt])) : {};
  const allowed = [];
  const base = blockStart(body, 'allowedModels');
  if (base >= 0) {
    const indent = indentOf(body[base]);
    let current = null;
    for (let i = base + 1; i < body.length; i += 1) {
      const line = body[i];
      if (!line.trim()) continue;
      if (indentOf(line) <= indent && !/^\s*-/.test(line)) break;
      const start = /^\s*-\s*(.*)$/.exec(line);
      if (start) {
        current = {};
        allowed.push(current);
        const inline = /^(provider|model):\s*(\S+)/.exec(start[1]);
        if (inline) current[inline[1]] = unquote(inline[2]);
        continue;
      }
      const pair = /^\s*([a-z]+):\s*(\S+)/.exec(line);
      if (pair && current) current[pair[1]] = unquote(pair[2]);
    }
  }
  return { enabled: config.enabled !== 'false', allowed };
}

/**
 * Child sessions this session started, newest first, from DSH's projection
 * cache. The catalog row is what the delegation tools themselves publish, so
 * the list is the same one the desktop sidebar shows.
 * @param {unknown} cache parsed `session-*.json`
 */
export function parseSubagentFleet(cache) {
  const rows = cache?.record?.rows ?? cache?.rows ?? {};
  const head = rows.subagentCatalog?.val?.head?.values;
  const list = Array.isArray(head)
    ? head
      .filter((row) => row && typeof row.childId === 'string')
      .map((row) => ({
        id: row.childId,
        label: typeof row.label === 'string' ? row.label : '',
        mode: typeof row.mode === 'string' ? row.mode : '',
        at: Number(row.childCreatedAt) || 0,
      }))
      .sort((a, b) => b.at - a.at)
    : [];
  const policy = rows.subagentModelSelectionPolicy?.val;
  return { children: list, policy: policy && typeof policy === 'object' ? policy : null };
}
