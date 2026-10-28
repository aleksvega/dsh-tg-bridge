// Subagents, skills and the persona file: what the profile declares and what a person can rewrite from the chat.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { readdirSync, writeFileSync } from 'node:fs';
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

/** Replace (or create) the persona section, leaving the rest untouched. */
export function setSoul(text) {
  const body = read(AGENTS);
  const at = body.indexOf(PERSONA_HEADING);
  const head = at === -1 ? `${body.trimEnd()}\n\n` : body.slice(0, at).trimEnd() + '\n\n';
  writeFileSync(AGENTS, `${head}${PERSONA_HEADING}\n\n${text.trim()}\n`, 'utf8');
}
