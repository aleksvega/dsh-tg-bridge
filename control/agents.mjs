// Subagents, skills and the persona file: what the profile declares and what a person can rewrite from the chat.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModelSelection, parseSubagentFleet, parseSubagentRows } from '../agents.mjs';
import { DSH_HOME } from '../paths.mjs';

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
  try {
    if (existsSync(AGENTS)) copyFileSync(AGENTS, `${AGENTS}.bak`);
  } catch {
    // A backup that cannot be written must not block the person's edit.
  }
  writeFileSync(AGENTS, next, 'utf8');
}
