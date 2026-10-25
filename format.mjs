// Markdown -> Telegram HTML, and the splitting that keeps both sides valid.
//
// Everything here is pure so it can be tested without a bot token or a poll
// loop: the bridge imports it, the tests import it, and the two bugs it exists
// for were both about size — an HTML string cut at 3800 characters loses its
// closing tags, and the plain fallback used to resend that markup verbatim.

/** Hard split of one oversized line, preferring a newline near the limit. */
export function chunk(text, size = 4000) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.length) out.push(rest);
  return out;
}

/**
 * Turn model markdown into plain readable text.
 *
 * The plain path sends without `parse_mode`, so every `**bold**`, `### heading`
 * and `` `code` `` must lose its markers or the person reads punctuation. It is
 * also the fallback when Telegram refuses a formatted message, which is why it
 * strips tags and entities too: a fragment that already carries HTML must never
 * arrive as `<b>` and `<code>`.
 */
export function toPlainText(input) {
  let text = String(input ?? '');
  text = text.replace(/<\/?(?:b|strong|i|em|u|s|del|code|pre|blockquote|a)\b[^>]*>/gi, '');
  text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  // Fenced code blocks: keep the body, drop the fence and language tag.
  text = text.replace(/```[a-zA-Z0-9]*\n?/g, '').replace(/```/g, '');
  // Inline code and bold/italic/strike markers.
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  // Headings: "### Title" -> "Title".
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // Links: [label](url) -> label (url); bare <url> stays as is.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  // Blockquote markers at line start.
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  // Bullets keep a dash, but "  - x" indentation is dropped to one level.
  text = text.replace(/^\s*[-*+]\s+/gm, '— ');
  // Tables: drop the separator row first (it is pure punctuation), then turn
  // the remaining rows into one line each with " · " between cells. The
  // separator pattern uses [ \t] rather than \s so it cannot eat the newline
  // and glue neighbouring rows together.
  text = text.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_match, row) => row.split('|').map((cell) => cell.trim()).filter((cell) => cell !== '').join(' · '));
  // Collapse the blank runs the removals leave behind.
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** Escape the four characters Telegram's HTML parser treats as markup. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Inline markdown inside one non-code segment -> Telegram HTML. */
function inlineHtml(segment) {
  let text = escapeHtml(segment);
  // Inline code first: its body must not be touched by the emphasis rules.
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
  text = text.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
  text = text.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  // Headings become bold lines.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+)$/gm, '<b>$1</b>');
  // Links: [label](url) -> label (url), both already escaped.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  // Blockquote markers.
  text = text.replace(/^[ \t]{0,3}&gt;[ \t]?/gm, '');
  // Bullets.
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '— ');
  // Tables: drop the separator row, then join cells with a middle dot.
  text = text.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row) => row.split('|').map((cell) => cell.trim()).filter(Boolean).join(' · '));
  return text;
}

/**
 * Markdown -> Telegram HTML with real <pre><code> blocks.
 *
 * A fenced block is what gives the person a tap-to-copy button in Telegram,
 * which is the whole point for shell commands. Everything else stays plain so
 * a malformed entity cannot reject the message.
 */
export function toTelegramHtml(input) {
  const source = String(input ?? '');
  const parts = source.split(/```/);
  let out = '';
  parts.forEach((segment, index) => {
    if (index % 2 === 1) {
      // Odd indexes are fenced code. The first line may be a language tag.
      const newline = segment.indexOf('\n');
      const firstLine = newline === -1 ? '' : segment.slice(0, newline).trim();
      const isLanguage = /^[a-zA-Z0-9+#.-]{1,20}$/.test(firstLine);
      const body = isLanguage ? segment.slice(newline + 1) : segment;
      const language = isLanguage ? firstLine.toLowerCase() : '';
      const cls = language ? ` class="language-${language}"` : '';
      out += `<pre><code${cls}>${escapeHtml(body.replace(/\n+$/, ''))}</code></pre>`;
    } else {
      out += inlineHtml(segment);
    }
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Split markdown into pieces Telegram can take, never inside a fenced block.
 *
 * Cutting the converted HTML was the bug behind a chat full of literal `<b>`
 * and `<code>`: a cut between `<pre><code>` and its closing tag made every part
 * invalid, so Telegram rejected each one and the fallback resent the same
 * broken markup as plain text. The source is the only safe place to cut, and a
 * fence is re-opened on the next piece so a long listing stays copyable.
 */
export function markdownParts(input, limit = 2900) {
  const parts = [];
  let buffer = [];
  let openFence = '';
  const size = () => buffer.reduce((total, line) => total + line.length + 1, 0);
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) parts.push(text);
    buffer = [];
  };
  for (const line of String(input ?? '').split('\n')) {
    const fence = /^\s*```/.test(line);
    if (buffer.length && size() + line.length + 1 > limit) {
      if (openFence) {
        buffer.push('```');
        flush();
        buffer.push(openFence);
      } else {
        flush();
      }
    }
    buffer.push(line);
    if (fence) openFence = openFence ? '' : line.trim();
  }
  flush();
  // One absurdly long line still has to arrive: fall back to a hard cut.
  return parts.flatMap((part) => chunk(part, limit).map((piece) => piece.trim()).filter(Boolean));
}
