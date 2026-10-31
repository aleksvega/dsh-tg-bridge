// A provider's error page, delivered as if it were the answer.
//
// What happened: a 570-second gateway limit came back as the assistant's own
// message — `[req_e00194ab] [deepseek-v4.1-flash] **Request exceeded 570s
// limit** … **Recommended tools:** — these responses are optimized for
// opencode, Claude Code and Codex`. The turn was logged as `ok`, the wall of text
// was sent to the chat as the bot's reply, and the fallback chain never ran,
// because nothing in the pipeline had failed. The person read an advertisement
// for other clients, in a topic where nothing was wrong with their request.
//
// The shape is recognisable and cheap to recognise: a request id, a limit, and a
// template with "How to fix" / "Billing" / "Recommended tools" in it. Detection
// is deliberately strict — a banner at the START of the text, with the
// scaffolding present — because an answer that merely QUOTES such an error (this
// file's own subject, for instance) is an answer.
const HEAD = /^\[(req_[0-9a-z]{4,})\]\s*(?:\[([^\]\n]{1,60})\])?/i;
const LIMIT = /request exceeded\s+(\d+)\s*(?:s|sec|secs|seconds)?\b[^\n]{0,40}limit/i;
const SCAFFOLD = /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?(?:how to fix|billing|recommended tools)(?:\*\*)?\s*:/i;

/**
 * The banner in `text`, or null. `rest` is what the model said after it, when
 * anything — a banner followed by real work is a real answer with a vendor's
 * noise in front of it, and swallowing the work would be worse than the noise.
 */
export function providerBanner(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const head = HEAD.exec(raw);
  const limit = LIMIT.exec(raw);
  // A request id alone is a log tag, and a limit alone could be the subject of a
  // conversation. Together with the vendor's template they are an error page.
  if (!head && !limit) return null;
  if (!SCAFFOLD.test(raw)) return null;
  return {
    requestId: head?.[1] || '',
    model: head?.[2] || '',
    seconds: limit ? Number(limit[1]) : 0,
    rest: restAfter(raw),
  };
}

/**
 * Everything after the vendor's last section.
 *
 * The template ends with "Recommended tools:" and one paragraph of advice, so
 * that paragraph is the boundary. Without it there is no safe cut point — a
 * guess would truncate a real answer — and an empty string is the honest answer.
 */
function restAfter(raw) {
  const paragraphs = raw.split(/\n\s*\n/);
  const at = paragraphs.findIndex((paragraph) => /recommended tools/i.test(paragraph));
  if (at === -1) return '';
  return paragraphs.slice(at + 1).join('\n\n').trim();
}

/**
 * The one line a failure carries: short, stable, and ours — not the vendor's
 * text. Every later step matches on this (`failureFamily`, `explainFailure`),
 * so the wall of text can never be mistaken for a family or pasted back into the
 * chat by the error path.
 */
export function bannerError(banner) {
  return `PROVIDER_TIMEOUT: ${banner?.seconds || '?'}`;
}
