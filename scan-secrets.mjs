// scan-secrets.mjs — the check that has to run before a push, not after.
//
// Why this file exists: `jev-gate` does ask Jev "has_secrets", but only when
// someone runs it by hand, and it describes the diff to a remote model instead
// of deciding locally. A machine id, a chat id, a token or a personal Windows
// home path is not a judgement call — it is a string match — so this check is
// deterministic, offline and free, and it runs on every push through a git hook
// (`install-hooks.mjs`).
//
// The rules are filters, not secrets themselves: the repo stays publishable and
// this list still cannot be used to recover what it was catching.
//
// Usage: node scan-secrets.mjs [--staged | --range <A..B> | --all] [--peers <dir>]
// Exit 0 = clean, 1 = findings (printed one per line, file:line).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Shipped rules. `re` must have the global flag off: one match is enough.
 * `why` is what the person sees, so it says what leaked, not what matched.
 */
export const RULES = [
  { id: 'token', re: /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/, why: 'an API key or token' },
  { id: 'key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, why: 'a private key' },
  { id: 'bearer', re: /["']Bearer\s+[A-Za-z0-9._-]{24,}["']/, why: 'a bearer token literal' },
  { id: 'win-path', re: /[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z0-9._-]+\\/, why: 'an absolute Windows path with a user name' },
  { id: 'home-path', re: /(?:^|[^<*"'`\w])\/?home\/[a-z_][a-z0-9_-]{2,}\//, why: 'an absolute home path' },
  { id: 'machine-id', re: /\b[0-9A-Fa-f]{16}\b(?!\.png|\.jpg|\.gif)/, why: 'a 16-hex machine id' },
  { id: 'chat-id', re: /\bchat_?id\b\s*[:=]\s*['"]?-?\d{8,}/i, why: 'a chat id' },
  { id: 'email-env', re: /\b(?!noreply@|example\.)[A-Za-z0-9._%+-]+@(?:gmail|yandex|mail|outlook|hotmail|proton|yahoo)\.[a-z]{2,}\b/, why: 'a personal email address' },
  // A commit's identity comes from `git config` on whichever machine committed,
  // so it is the one place a personal address appears without ever being in a
  // file. `--all` reads the log through `git log --format`, not the tree.
  { id: 'email-author', re: /^(?:Author|Committer):\s.*<[^>]*@(?!users\.noreply\.github\.com|noreply@)[^>]*\.[a-z]{2,}>/m, why: 'a commit authored with a personal email address' },
];

/**
 * Personal rules live outside the repo: the repo is public, so a list of the
 * names to hide cannot be inside it. One rule per line, `#` comments allowed.
 * Returns [] when the file is absent — a public clone then still gets RULES.
 */
export function loadPeers(dir = process.env.DSH_SECRET_PEERS || join(homedir(), '.dsh-tg-bridge-peers')) {
  const path = join(dir, 'peers.txt');
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => ({ id: 'peer', re: new RegExp(`(?<![\\w.-])${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'i'), why: 'a private identifier' }));
  } catch {
    return [];
  }
}

/** Pushable files: a deletion has nothing to leak and is skipped. */
function filesOf(root, mode, range, run) {
  const args = mode === 'all' ? ['ls-files'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR'];
  if (mode === 'range') args.splice(1, 1, range, '--name-only', '--diff-filter=ACMR');
  const out = run(...args).trim();
  return out ? out.split(/\r?\n/).filter((name) => existsSync(join(root, name))) : [];
}

/** Line-by-line scan of the text of `file`; binary files are skipped. */
export function scanText(text, rules = RULES) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('\u0000') || line.length > 20000) return;
    for (const rule of rules) {
      if (rule.re.test(line)) hits.push({ line: index + 1, id: rule.id, why: rule.why });
    }
  });
  return hits;
}

/**
 * Every commit's identity, which no file in the tree reveals.
 *
 * `git config user.email` is whatever the machine had; a clone, a work laptop or
 * an old `git commit --author` can carry a personal address into history forever.
 * Only who committed is read, never what — so this stays cheap on any history and
 * needs no diff.
 */
export function scanAuthors({ root = process.cwd(), range = '' } = {}) {
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let log = '';
  try {
    log = run('log', ...(range ? [range] : ['--all']), '--format=Author: %an <%ae>%nCommitter: %cn <%ce>');
  } catch {
    return [];
  }
  const findings = [];
  const seen = new Set();
  for (const line of log.split(/\r?\n/)) {
    for (const rule of RULES) {
      if (rule.id !== 'email-author' || !rule.re.test(line)) continue;
      const key = line.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ file: 'git history', line: 0, id: rule.id, why: rule.why, text: `${line.trim()} — ${rule.why} [${rule.id}]` });
    }
  }
  return findings;
}

/** Scan every pushable file and return readable findings. */
export function scanRepo({ root = process.cwd(), mode = 'staged', range = '', peers = loadPeers() } = {}) {
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rules = [...RULES, ...peers];
  const findings = [];
  for (const name of filesOf(root, mode, range, run)) {
    let text = '';
    try {
      text = readFileSync(join(root, name), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    for (const hit of scanText(text, rules)) {
      findings.push({ file: name, ...hit, text: `${name}:${hit.line}: ${hit.why} [${hit.id}]` });
    }
  }
  return findings;
}

/**
 * What the person can still see in the repo's own history: a pushed secret is
 * already public, and the only honest answer is "rotate it now".
 */
export function warnHistory(root = process.cwd()) {
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const refs = run('for-each-ref', '--format=%(refname:short)', 'refs/remotes');
    if (!refs.trim()) return [];
    const wt = process.env.DSH_TG_BRIDGE_WORKTREE || 'dsh-tg-bridge-oss';
    const commits = run('log', '--all', '--format=%H').trim().split(/\r?\n/).filter(Boolean);
    const also = ['--', ...(commits.length > 200 ? commits.slice(0, 200) : [])];
    const out = run('grep', '-I', '-l', '-E', wt, ...also).trim();
    return out ? out.split(/\r?\n/).map((line) => line.split(':').slice(0, 2).join(': ')) : [];
  } catch {
    return [];
  }
}

// `process.exit()` can cut stdout before Node flushes a piped stream, which made
// the first hook run report "clean" for a file that was not. Setting the code
// and letting the loop drain is the whole fix.
if (process.argv[1] && process.argv[1].endsWith('scan-secrets.mjs')) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] || '' : '';
  };
  const mode = argv.includes('--all') ? 'all' : flag('--range') ? 'range' : 'staged';
  // `--report-only` is for advice about what is already public: the pre-push
  // hook prints it and lets the push through. It never weakens the gate on new
  // content, only on findings that existed before this push.
  const reportOnly = argv.includes('--report-only');
  const peersDir = flag('--peers');
  try {
    const findings = scanRepo({ mode, range: flag('--range'), peers: loadPeers(peersDir || undefined) });
    // History is only checked when the whole repo is asked about: a staged scan
    // runs in a pre-commit hook, where a full log read would slow every commit
    // and could not fix an author that is already there.
    const authorFindings = mode === 'all' ? scanAuthors({ range: flag('--range') }) : [];
    const all = [...findings, ...authorFindings];
    if (all.length === 0) {
      process.stdout.write('scan-secrets: clean\n');
    } else {
      for (const finding of all) process.stderr.write(`${finding.text}\n`);
      if (reportOnly) {
        process.stderr.write(`\nscan-secrets: ${all.length} finding(s), reported only.\n`);
        process.exitCode = 0;
      } else {
        process.stderr.write(`\nscan-secrets: ${all.length} finding(s); nothing was pushed.\n`);
        if (authorFindings.length > 0) {
          process.stderr.write('A commit identity is not fixed by editing a file: rewrite the author\n');
          process.stderr.write('(git rebase --exec or git filter-repo) or set git config user.email to a\n');
          process.stderr.write('noreply address before the next commit.\n');
        }
        process.stderr.write('Fix the line, or (if it has to stay) override with git push --no-verify.\n');
        process.exitCode = 1;
      }
    }
  } catch (error) {
    // A broken scanner must not be mistaken for a clean tree.
    process.stderr.write(`scan-secrets: cannot scan (${error?.message || error})\n`);
    process.exitCode = 2;
  }
}

// Re-exported for the hook, which lists the probes instead of the secrets.
export function peerFileNames(dir = join(homedir(), '.dsh-tg-bridge-peers')) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.txt'));
  } catch {
    return [];
  }
}