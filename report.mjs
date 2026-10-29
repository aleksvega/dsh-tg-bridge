// A bug report the owner can act on, built from what the bridge already knows.
//
// Why this exists: "the bot went silent" arrives as a sentence with no version,
// no platform and no error, so every report costs a round trip of questions.
// This module assembles that context into one small text bundle — and redacts it
// before it leaves the machine, because a log tail is exactly where a token, a
// home path or a chat id ends up by accident.
//
// The redaction is deliberately the same shape as `scan-secrets.mjs`'s shipped
// rules: a report that would fail that check must never be sent, so the test
// runs the real rules over a fixture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';

/** How much of the log tail travels: enough for one failure, small enough to read. */
export const TAIL_LINES = 120;
/** Ceiling on the whole bundle, so a document never becomes a novel. */
export const MAX_CHARS = 60_000;

/**
 * Replace anything that identifies a person or grants access.
 *
 * Ordered: a token can contain a path-like tail, so tokens go first; the home
 * path is replaced with `<home>` rather than blanked, because "a path under the
 * home directory" is the diagnostic fact and the name is not.
 */
export function redact(input, home = homedir(), ids = []) {
  let text = String(input ?? '');
  // The ids this bridge actually serves, replaced exactly. A pattern cannot know
  // that `in 311217285` is a chat and `tokens=311217285` is not; the caller does,
  // so those numbers are given, not guessed.
  for (const id of ids) {
    const digits = String(id ?? '').replace(/\D/g, '');
    if (digits.length < 5) continue;
    text = text.replace(new RegExp(`(?<!\\d)${digits}(?!\\d)`, 'g'), '<id>');
  }
  // Keys and tokens, the same families the repo's own scanner knows.
  text = text.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, '<token>');
  text = text.replace(/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, '<private-key>');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1<token>');
  // A bot token is `<digits>:<base64ish>` and is the one credential the bridge
  // itself holds; it appears in URLs, so the shape is what has to be caught.
  text = text.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '<bot-token>');
  // The home directory: `<home>` keeps the fact, drops the name.
  const dir = String(home || '').replace(/[\\/]+$/, '');
  if (dir) {
    for (const variant of new Set([dir, dir.replace(/\\/g, '/'), dir.replace(/\//g, '\\')])) {
      if (variant.length < 4) continue;
      text = text.split(variant).join('<home>');
    }
  }
  text = text.replace(/\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[^\\/\s]+/g, '<home>');
  text = text.replace(/\/(?:home|Users)\/[A-Za-z0-9._-]+\//g, '<home>/');
  // A chat id is a person's Telegram account, and an 8+ digit run in a log line
  // is almost always one.
  text = text.replace(/\b(chat_?id|chat|thread|user_?id)\b(\s*[:=]\s*)-?\d{6,}/gi, '$1$2<id>');
  text = text.replace(/\bchat\s+\d{6,}\b/g, 'chat <id>');
  // Machine ids and long hex digests: not secrets, but not the reporter's either.
  text = text.replace(/\b[0-9A-Fa-f]{16}\b(?!\.(?:png|jpg|gif|json|mjs|js|yml|md))/g, '<hex>');
  // Every address, except the reserved `example.` domains a fixture uses.
  text = text.replace(/\b[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>');
  return text;
}

/** The last `count` non-empty lines of a file, or [] when it cannot be read. */
export function tailOf(file, count = TAIL_LINES) {
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

/**
 * Assemble the bundle. Every field is optional and every one is redacted: a
 * missing fact is written as "unknown" rather than dropped, so a reader can tell
 * "not collected" from "collected and empty".
 *
 * @param {object} facts what the caller knows
 * @param {string} [facts.version] bridge version
 * @param {string} [facts.profile] DSH profile the topic runs under
 * @param {string} [facts.model] `provider/model` of the turn
 * @param {string} [facts.chain] fallback chain as one line
 * @param {string} [facts.failure] the explained failure, if there was one
 * @param {string} [facts.cwd] the directory the turn ran in
 * @param {string} [facts.preset] permission preset of the running profile
 * @param {string[]} [facts.tools] tool names the turn called
 * @param {string[]} [facts.log] log lines
 * @param {Array<string|number>} [facts.ids] chat/user ids this bridge serves
 * @param {string} [facts.home] home directory to strip
 */
export function buildReport(facts = {}) {
  const {
    version = '', profile = '', model = '', chain = '', failure = '', cwd = '',
    preset = '', tools = [], log = [], home = homedir(), note = '', ids = [],
  } = facts;
  const head = [
    '# dsh-tg-bridge report',
    '',
    `bridge:   ${version || 'unknown'}`,
    `node:     ${process.version}`,
    `system:   ${platform()} ${release()}`,
    `profile:  ${profile || 'unknown'}`,
    `preset:   ${preset || 'unknown'}`,
    `model:    ${model || 'unknown'}`,
    `chain:    ${chain || 'none'}`,
    `cwd:      ${cwd || 'unknown'}`,
    `tools:    ${tools.length ? [...new Set(tools)].join(', ') : 'none in this turn'}`,
    `time:     ${new Date().toISOString()}`,
  ];
  if (note) head.push(`note:     ${note}`);
  const parts = [head.join('\n')];
  if (failure) parts.push(`## failure\n\n${failure}`);
  if (log.length) parts.push(`## log tail (${log.length} lines)\n\n${log.join('\n')}`);
  const text = redact(parts.join('\n\n'), home, ids);
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… truncated` : text;
}

/**
 * Write the bundle next to the bridge's state and return its path.
 *
 * The name carries the time, so two reports from one topic never overwrite each
 * other and the person can say "the one from 14:20".
 */
export function writeReport(text, dir, at = new Date()) {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(dir, `report-${stamp}.md`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    return path;
  } catch {
    return '';
  }
}

/** Whether a report file is there, for a caller that only has the path. */
export const reportExists = (path) => Boolean(path) && existsSync(path);
