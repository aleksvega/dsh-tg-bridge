// Adding an endpoint to a profile from the chat, without a model in the loop.
//
// "I have a new provider, here is its URL and its key" is a configuration edit,
// not a conversation: it is four facts typed once, and routing it through an AI
// turn means a slow answer, a paraphrase of a URL that must be exact, and a
// token spent on what a `sed` could do. So `/endpoint add` parses the line and
// writes the patch itself.
//
// What it refuses matters more than what it does. A provider row that is
// malformed, duplicated, or missing its key variable turns a working profile
// into one that cannot start, and the failure would show up on the next turn as
// "the bot is broken" rather than "the line you typed has a typo". Every check
// below exists because that class of silent breakage is expensive to trace.
import { read, writePatch, patchPath } from './models.mjs';
import { providerRows } from '../model-probe.mjs';

/** A provider id the patch can carry and a button can name. */
const ID = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * A base URL that a request can be built on.
 *
 * https only: an endpoint is where API keys are sent, and a plain-http one
 * would leak the key on every turn. localhost is the one exception that earns
 * it — a model server on the same machine never crosses the network.
 */
export function checkBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: false, why: 'empty' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, why: 'notUrl' };
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return { ok: false, why: 'insecure' };
  if (!url.hostname) return { ok: false, why: 'notUrl' };
  return { ok: true, url: text.replace(/\/+$/, ''), local };
}

/** The env var a key is read from: a name, never the key itself. */
export function checkKeyEnv(value) {
  const name = String(value || '').trim();
  if (!name) return { ok: false, why: 'empty' };
  if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(name)) return { ok: false, why: 'notName' };
  return { ok: true, name };
}

/**
 * Parse `/endpoint add <id> <baseURL> <keyEnv> [model,model,...]`.
 *
 * The model list is optional: an endpoint is worth declaring before a model is
 * known, because the id of a model is often what the first request reveals.
 * Declaring the endpoint first and the model after is two honest steps; making
 * the model mandatory would mean a person guesses an id and the guess ships.
 */
export function parseEndpointArgs(args) {
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, why: 'usage' };
  const verb = parts[0].toLowerCase();
  if (verb === 'list' || verb === 'check') return { ok: true, verb, rest: parts.slice(1) };
  if (verb === 'rm' || verb === 'remove') {
    if (parts.length !== 2) return { ok: false, why: 'usage' };
    const id = parts[1].toLowerCase();
    if (!ID.test(id)) return { ok: false, why: 'badId' };
    return { ok: true, verb: 'rm', id };
  }
  if (verb !== 'add') return { ok: false, why: 'usage' };
  if (parts.length < 4) return { ok: false, why: 'usage' };
  const id = parts[1].toLowerCase();
  if (!ID.test(id)) return { ok: false, why: 'badId' };
  const url = checkBaseUrl(parts[2]);
  if (!url.ok) return { ok: false, why: `url.${url.why}` };
  const key = checkKeyEnv(parts[3]);
  if (!key.ok) return { ok: false, why: `key.${key.why}` };
  const models = parts.slice(4).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  for (const model of models) {
    if (!/^[\w.:-]+$/.test(model) || model.length > 80) return { ok: false, why: 'badModel', model };
  }
  return { ok: true, verb: 'add', id, baseURL: url.url, keyEnv: key.name, models };
}

/** The provider block as text, or '' when the profile has no provider with that id. */
export function providerBlock(text, id) {
  const lines = String(text || '').split('\n');
  const at = lines.findIndex((line) => /^\s*providers:\s*$/.test(line));
  if (at < 0) return { ok: false, why: 'noProviders' };
  const rowIndent = (/^(\s*)/.exec(lines.slice(at + 1).find((line) => line.trim() && !/^\s*#/.test(line)) || '') || [])[1]?.length;
  if (!Number.isFinite(rowIndent)) return { ok: false, why: 'noProviders' };
  let start = -1;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = (/^\s*/.exec(line) || [''])[0].length;
    if (indent < rowIndent) break;
    if (indent !== rowIndent) continue;
    const row = /^\s*([\w.-]+):\s*$/.exec(line);
    if (!row) continue;
    if (start >= 0) return { ok: true, start, end: i, rowIndent };
    if (row[1] !== id) continue;
    start = i;
  }
  if (start < 0) return { ok: false, why: 'missing' };
  // The last provider's block ends where the provider list ends, which is the
  // first line shallower than a provider row — not the end of the file. Reading
  // the end of the file as its end would delete every plugin row below it.
  let end = start + 1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      end = i + 1;
      continue;
    }
    const indent = (/^\s*/.exec(line) || [''])[0].length;
    if (/^\s*#/.test(line)) {
      end = i + 1;
      continue;
    }
    if (indent < rowIndent) break;
    end = i + 1;
  }
  return { ok: true, start, end, rowIndent };
}

/** The provider rows a profile declares, with the facts the list shows. */
export function endpointRows(profile) {
  const text = read(patchPath(profile));
  const lines = text.split('\n');
  const models = new Map();
  let current = '';
  let inModels = false;
  for (const line of lines) {
    const row = /^ {6}([\w.-]+):\s*$/.exec(line);
    if (row) {
      current = row[1];
      inModels = false;
      continue;
    }
    if (/^\s*models:\s*$/.test(line)) {
      inModels = true;
      continue;
    }
    const id = /^\s*-\s*id:\s*(\S+)/.exec(line);
    if (id && inModels && current) {
      models.set(current, [...(models.get(current) || []), id[1]]);
      continue;
    }
    if (line.trim() && (/^\s*/.exec(line) || [''])[0].length <= 6) inModels = false;
  }
  return providerRows(text).map((row) => {
    const baseURL = /^\s*baseURL:\s*(\S+)/m.exec(row.lines.join('\n'));
    const apiKeyEnv = /^\s*apiKeyEnv:\s*(\S+)/m.exec(row.lines.join('\n'));
    return {
      id: row.id,
      baseURL: baseURL ? baseURL[1] : '',
      keyEnv: apiKeyEnv ? apiKeyEnv[1] : '',
      models: models.get(row.id) || [],
    };
  });
}

/**
 * Rebuild the patch with one provider added, replaced, or removed.
 *
 * Returns the new text instead of writing it, so the caller can show the diff it
 * is about to save and a test can hold the whole transformation without touching
 * a profile directory.
 */
export function withEndpoint(text, { verb, id, baseURL, keyEnv, models }) {
  const span = providerBlock(text, id);
  if (verb === 'rm') {
    if (!span.ok) return { ok: false, why: span.why === 'missing' ? 'missing' : span.why };
    const lines = text.split('\n');
    return { ok: true, text: [...lines.slice(0, span.start), ...lines.slice(span.end)].join('\n'), id };
  }
  // A new provider is written the way every shipped one is: the same keys in the
  // same order, so a file edited from the chat and a file edited by hand stay
  // readable next to each other.
  const block = (indent, extra) => {
    const pad = ' '.repeat(indent);
    const out = [
      `${pad}${id}:`,
      `${pad}  displayName: ${id}`,
      `${pad}  apiKeyEnv: ${keyEnv}`,
      `${pad}  api: openai-responses`,
      `${pad}  baseURL: ${baseURL}`,
      `${pad}  defaultContextWindow: 1000000`,
    ];
    if (extra.length > 0) {
      out.push(`${pad}  models:`);
      for (const model of extra) out.push(`${pad}    - id: ${model}`, `${pad}      name: ${model}`);
    }
    return out;
  };
  const lines = text.split('\n');
  if (!span.ok) {
    if (span.why === 'noProviders') return { ok: false, why: 'noProviders' };
    if (span.why === 'missing') {
      const at = lines.findIndex((line) => /^\s*providers:\s*$/.test(line));
      if (at < 0) return { ok: false, why: 'noProviders' };
      const next = lines.slice(at + 1).find((line) => line.trim() && !/^\s*#/.test(line));
      const indent = next ? (/^(\s*)/.exec(next) || [''])[0].length : 6;
      // Appended after the last provider line of the block: a reader scrolling
      // the file finds the new endpoint with the others, not at the bottom.
      const end = lines.findIndex((line, i) => i > at && line.trim() && (/^\s*/.exec(line) || [''])[0].length < indent);
      const stop = end < 0 ? lines.length : end;
      return { ok: true, text: [...lines.slice(0, stop), ...block(indent, models), ...lines.slice(stop)].join('\n'), id, added: true, modelsAdded: models };
    }
    return { ok: false, why: span.why };
  }
  // Replacing an existing provider keeps its line position and replaces only the
  // keys this command owns, so a hand-added `retryPolicy` or `models` list the
  // person curated is not wiped by a typo fix.
  const existing = lines.slice(span.start, span.end).join('\n');
  let next = existing;
  next = /^\s*baseURL:\s*\S+/m.test(next)
    ? next.replace(/^(\s*baseURL:\s*)\S+/m, `$1${baseURL}`)
    : next.replace(/^(\s*apiKeyEnv:.*)$/m, `$1\n${' '.repeat(span.rowIndent + 2)}baseURL: ${baseURL}`);
  next = /^\s*apiKeyEnv:\s*\S+/m.test(next)
    ? next.replace(/^(\s*apiKeyEnv:\s*)\S+/m, `$1${keyEnv}`)
    : next.replace(/^(\s*displayName:.*)$/m, `$1\n${' '.repeat(span.rowIndent + 2)}apiKeyEnv: ${keyEnv}`);
  const missing = models.filter((model) => !new RegExp(`^\\s*-\\s*id:\\s*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(next));
  if (missing.length > 0) {
    const pad = ' '.repeat(span.rowIndent + 4);
    const row = missing.map((model) => `\n${pad}- id: ${model}\n${' '.repeat(span.rowIndent + 6)}name: ${model}`).join('');
    // The new models go after the last model of the list, not before it: the
    // list is ordered by the patch's author and appending is the one edit that
    // cannot reorder what is already there. `replace` with a string keeps the
    // surviving prefix intact, so the last `- id:` line anchors the insert.
    const head = /^(\s*models:)[^\n]*$/m.exec(next);
    if (head) {
      // Append after the last line of the last model, not after the last `- id:`
      // match: a model has more keys below it (`name`, `contextWindow`), and
      // inserting at the id would cut one model in two, which YAML reads as a
      // model with two names and a stray key.
      const rows = [...next.matchAll(/^\s*-\s*id:.*$/gm)];
      const lastRow = rows[rows.length - 1];
      const tail = next.slice(lastRow.index).split('\n');
      let depth = 1;
      while (depth + 1 < tail.length) {
        const line = tail[depth + 1];
        if (!line.trim()) break;
        const indent = (/^\s*/.exec(line) || [''])[0].length;
        if (indent <= span.rowIndent + 4) break;
        depth += 1;
      }
      const consumed = tail.slice(0, depth + 1).join('\n').length;
      const at = lastRow.index + consumed;
      next = `${next.slice(0, at)}${row}${next.slice(at)}`;
    } else {
      next = next.replace(/^(\s*defaultContextWindow:.*)$/m, `$1\n${' '.repeat(span.rowIndent + 2)}models:${row}`);
    }
  }
  if (next === existing) return { ok: false, why: 'unchanged' };
  return {
    ok: true,
    text: [...lines.slice(0, span.start), ...next.split('\n'), ...lines.slice(span.end)].join('\n'),
    id,
    replaced: true,
    modelsAdded: missing,
  };
}

/** Apply a parsed `/endpoint` command to a profile. */
export function applyEndpoint(profile, parsed) {
  if (parsed.verb !== 'add' && parsed.verb !== 'rm') return { ok: false, why: 'usage' };
  const result = withEndpoint(read(patchPath(profile)), parsed);
  if (!result.ok) return result;
  writePatch(profile, result.text);
  return result;
}