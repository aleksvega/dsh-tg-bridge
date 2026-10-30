// Small text files travel as content, not as a path.
//
// A mid-turn steer cannot make the running model open a file, and even an idle
// turn pays a tool call for it, so the bridge pastes the text in. Binary and
// oversized files keep the old path-only behaviour.
import { readFileSync } from 'node:fs';

export const TEXTUAL_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yml', 'yaml', 'log',
  'ini', 'cfg', 'conf', 'toml', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua', 'sh', 'ps1',
  'bat', 'cmd', 'sql', 'env', 'properties', 'srt', 'vtt', 'diff', 'patch',
]);

export const INLINE_LIMIT = 60_000;

/**
 * Text body of a small text file, or '' when the file is not worth inlining.
 * Truncation is stated in the body so the model knows the file continues.
 */
export function inlineText(path, name, limit = INLINE_LIMIT) {
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  if (!TEXTUAL_EXT.has(ext)) return '';
  try {
    const buf = readFileSync(path);
    if (buf.length > limit) {
      return `${buf.subarray(0, limit).toString('utf8')}\n… [truncated: ${limit} of ${buf.length} bytes]`;
    }
    return buf.toString('utf8');
  } catch {
    return '';
  }
}
