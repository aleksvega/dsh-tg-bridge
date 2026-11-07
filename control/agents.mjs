// Subagents, skills and the persona file: what the profile declares and what a person can rewrite from the chat.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { copyFileSync, existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModelSelection, parseSubagentFleet, parseSubagentRows } from '../profile/agents.mjs';
import { DSH_HOME } from '../core/paths.mjs';

import { read, readJson, patchPath } from './models.mjs';
import { bareId } from './sessions.mjs';
/**
 * What a profile hands to the model as delegation tools, and which routes a
 * delegated turn may pick. Both live in the profile patch, so a topic's agents
 * are a property of the topic's profile, not of the bridge.
 */
export function agentsOf(profile) {
  const text = read(patchPath(profile));
  return { rows: parseSubagentRows(text), selection: parseModelSelection(text) };
}

/** Child sessions this session started, from DSH's projection cache. */
export function fleetOf(sessionId) {
  if (!sessionId) return { children: [], policy: null };
  const record = readJson(join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `session-${bareId(sessionId)}.json`));
  return parseSubagentFleet(record);
}

/** Loader rows a profile's own patch declares, nested groupings included. */
export function patchRows(profile) {
  const text = read(patchPath(profile));
  return [...text.matchAll(/^\s*-?\s*id:\s*\S+/gm)].length;
}

/** Skills directory listing. */
export function skillsOf() {
  const dir = join(DSH_HOME, 'skills');
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export const AGENTS = join(DSH_HOME, 'AGENTS.md');
export const PERSONA_HEADING = '## Persona (DSH soul)';

/** Persona section of the global instructions file. */
export function soulOf() {
  const text = read(AGENTS);
  const at = text.indexOf(PERSONA_HEADING);
  if (at === -1) return '';
  return text.slice(at + PERSONA_HEADING.length).replace(/^\s*\n/, '').trim();
}

/**
 * Replace (or create) the persona section, leaving the rest untouched.
 *
 * The rest has to actually survive. This file is the person's own global
 * instructions, written by hand, and the old version replaced everything from
 * the persona heading to the end of the file: a second `## Persona` section — or
 * any section that came after the first one — was silently deleted by a
 * `/soul` call. Now only the persona section is replaced, and the file is
 * copied aside first, because this is the one write in the bridge that can lose
 * text a person typed themselves.
 */
export function setSoul(text) {
  const body = read(AGENTS);
  const at = body.indexOf(PERSONA_HEADING);
  let next;
  if (at === -1) {
    next = `${body.trimEnd()}\n\n${PERSONA_HEADING}\n\n${text.trim()}\n`;
  } else {
    // The section ends at the next top-level heading, so whatever follows it
    // stays where it was.
    const after = body.slice(at + PERSONA_HEADING.length);
    const end = after.search(/\n##? /);
    const rest = end === -1 ? '' : after.slice(end);
    next = `${body.slice(0, at).trimEnd()}\n\n${PERSONA_HEADING}\n\n${text.trim()}\n${rest}`;
  }
  writeAside(AGENTS, next);
}

/** The bot-owned section `/remember` appends dated facts to. */
export const LEARNED_HEADING = '## Learned (DSH memory)';

/** How many notes the learned section may hold: the file is paid for on every request. */
export const MAX_LEARNED = 60;

/** The learned section, or '' when the file has none yet. */
export function learnedOf() {
  const body = read(AGENTS);
  const at = body.indexOf(LEARNED_HEADING);
  if (at === -1) return '';
  const after = body.slice(at + LEARNED_HEADING.length);
  const end = after.search(/\n## /);
  return (end === -1 ? after : after.slice(0, end)).replace(/^\s*\n/, '').trim();
}

/**
 * The file with the learned section replaced by `lines` (a no-op when there is
 * nothing to add and no section to change), or null.
 *
 * Everything around the section — the person's own hand-written text, the
 * persona, whatever came after — is moved, not rewritten: the section ends at
 * the next `## ` heading, and what follows it is reattached verbatim.
 */
function withLearned(lines) {
  const body = read(AGENTS);
  const at = body.indexOf(LEARNED_HEADING);
  if (at === -1) {
    if (lines.length === 0) return null;
    return `${body.trimEnd()}\n\n${LEARNED_HEADING}\n\n${lines.join('\n')}\n`;
  }
  const before = at === 0 ? '' : `${body.slice(0, at).trimEnd()}\n\n`;
  const after = body.slice(at + LEARNED_HEADING.length);
  const end = after.search(/\n## /);
  const following = end === -1 ? '' : after.slice(end).replace(/^\n+/, '').replace(/\n+$/, '');
  if (lines.length === 0) {
    const head = before.replace(/\n+$/, '');
    if (!head && !following) return '';
    return following ? `${head ? `${head}\n\n` : ''}${following}\n` : `${head}\n`;
  }
  return `${before}${LEARNED_HEADING}\n\n${lines.join('\n')}${following ? `\n\n${following}\n` : '\n'}`;
}

/** The learned section as note lines, oldest first. */
function learnedLines() {
  const list = learnedOf();
  return list ? list.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

/**
 * Add one dated note to the learned section, dropping the oldest past the cap.
 *
 * The write goes through a temp file renamed into place: the harness re-reads
 * this file, and a half-written one would be instructions for exactly one
 * request.
 *
 * @returns {{ dropped: number, count: number }}
 */
export function appendLearned(note, { max = MAX_LEARNED, now = new Date() } = {}) {
  const text = String(note || '').trim();
  const added = `- ${now.toISOString().slice(0, 10)} — ${text}`;
  const lines = learnedLines();
  lines.push(added);
  const dropped = Math.max(0, lines.length - Math.max(1, max));
  const kept = lines.slice(dropped);
  writeAside(AGENTS, withLearned(kept));
  return { dropped, count: kept.length };
}

/**
 * Replace the whole learned section (the caller supplies every surviving line),
 * or remove it when the new text is empty.
 *
 * `/remember forget` works on whole lines because a note is one line: no edit
 * can stop halfway through a fact and leave a sentence that says two things.
 *
 * @returns {boolean} whether the file changed
 */
export function setLearned(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const next = withLearned(lines);
  if (next === null) return false;
  writeAside(AGENTS, next);
  return true;
}

/**
 * Write the instructions file: a copy first, then a rename, never in place.
 * A copy that cannot be written must not block the write it was made for.
 */
function writeAside(file, next) {
  try {
    if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  } catch {
    // Nothing to recover from — the write itself is the record.
  }
  writeFileSync(`${file}.tmp`, next, 'utf8');
  renameSync(`${file}.tmp`, file);
}
