// Where `/cd` points, decided without touching a real filesystem.
//
// The old resolver tested `existsSync` and stopped there: a path to a FILE was
// "bound" and every later turn spawned with a file as its working directory,
// which fails inside the CLI with an error nobody can read. A missing path was
// reported as "no such directory" using the raw input rather than the path it
// actually tried.
//
// Pure on purpose: `probe` is the only filesystem question, so the table of
// cases below is a test, not a story about a machine.
import { isAbsolute, join, normalize, resolve } from 'node:path';

/** How a topic path was understood — the reply says which, so nobody guesses. */
export const CD_KIND = {
  ABSOLUTE: 'absolute',
  HOME: 'home',
  PROJECT: 'project',
  RELATIVE: 'relative',
};

/** `C:\x`, `C:/x`, `\\server\share`, `/x` — anything the platform calls absolute. */
function looksAbsolute(input) {
  return /^[A-Za-z]:[\\/]/.test(input) || /^\\\\/.test(input) || input.startsWith('/') || isAbsolute(input);
}

/**
 * Turn what a person typed into the directory a turn should run in.
 *
 * Order matters and is the whole point: an absolute path is never re-interpreted
 * as a project name, and a bare word is never treated as a relative path from
 * the bridge's own directory — `my-app` means `<projectsDir>/my-app`, because
 * that is what a person means when they type it.
 *
 * @param {string} input what followed `/cd`
 * @param {object} ctx
 * @param {string} ctx.home the user's home directory
 * @param {string} ctx.projectsDir where bare names are looked up
 * @param {string} ctx.configCwd directory a relative path resolves against
 * @param {(path: string) => 'dir'|'file'|'none'} ctx.probe
 * @returns {{path: string, kind: string} | {error: 'empty'|'none'|'notdir', path: string, kind: string}}
 */
export function resolveCd(input, { home, projectsDir, configCwd, probe }) {
  const raw = String(input ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!raw) return { error: 'empty', path: '', kind: '' };

  let candidate = raw;
  let kind = CD_KIND.ABSOLUTE;
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    kind = CD_KIND.HOME;
    candidate = join(home, raw.slice(1));
  } else if (looksAbsolute(raw)) {
    kind = CD_KIND.ABSOLUTE;
  } else if (raw.includes('/') || raw.includes('\\')) {
    // A relative path with a separator is a path, not a project name.
    kind = CD_KIND.RELATIVE;
    candidate = resolve(configCwd || home, raw);
  } else {
    kind = CD_KIND.PROJECT;
    candidate = join(projectsDir, raw);
  }

  const path = normalize(candidate);
  const found = probe(path);
  // A file is not a working directory. Saying "no such directory" about a file
  // that is plainly there is the reply that turned this into a bug report.
  if (found === 'file') return { error: 'notdir', path, kind };
  if (found !== 'dir') return { error: 'none', path, kind };
  return { path, kind };
}
