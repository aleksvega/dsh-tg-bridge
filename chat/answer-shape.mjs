// What the chat refuses to forward from a finished answer.
//
// The reasoning guard answers "the model sent its notes and nothing else". This
// one answers a different, more embarrassing shape: notes wrapped around a real
// answer. A turn that ends with an English plan — "Live page confirmed…", "Should
// I update the goal task list?", "Keep ~5 lines." — in front of a Russian reply is
// still an answer, so the reasoning guard stays silent, and the person reads the
// model thinking out loud in a language they did not ask for.
//
// The repair is deterministic and narrow: a paragraph that is not in the
// conversation's language and reads like planning is dropped when a real answer
// follows. Nothing is guessed, nothing is rewritten, and a reply that would come
// out empty is returned untouched — a wrong paragraph is a bruise, a swallowed
// answer is a wound.
import { normalizeLang } from '../core/i18n.mjs';

const FENCE = /^\s*(?:```|~~~)/;

/** Letters of each script in a run of text, so "which language" is a count. */
export function scriptProfile(text) {
  const value = String(text ?? '');
  const count = (re) => (value.match(re) || []).length;
  return {
    latin: count(/[A-Za-z]/g),
    cyrillic: count(/[\u0400-\u04FF]/g),
    cjk: count(/[\u4E00-\u9FFF]/g),
    length: value.trim().length,
  };
}

/**
 * Does this text speak the conversation's language?
 *
 * `en` is counted as "not Russian and not Chinese": the answer may quote code,
 * identifiers and file names, so the question is which script dominates.
 */
export function speaksLang(text, lang) {
  const p = scriptProfile(text);
  const letters = p.latin + p.cyrillic + p.cjk;
  if (!letters) return true;
  if (lang === 'ru') return p.cyrillic / letters >= 0.3;
  if (lang === 'zh') return p.cjk / letters >= 0.3;
  return p.latin / letters >= 0.5;
}

/** A line that announces what the model is about to do, rather than doing it. */
const PLAN_CUES = [
  /^(?:now|next|then|so|also|and|but|first|finally)\b/i,
  /^(?:should i|let me|let's|i'll|i will|i need to|i should|i could)\b/i,
  /^(?:final answer|keep ~?\d+ lines?|todo:|next step)\b/i,
  /^(?:live page|page confirmed|checked|verified)\b/i,
  /\b(?:the answer|my reply|the reply|the person)\b.*\b(?:russian|english|chinese|language)\b/i,
];

/** Planning prefixes that a real sentence can follow: drop the label, keep the text. */
const PLAN_LABEL = /^(?:mention|note|final answer|answer|reply|next step|todo)\s*:\s*/i;

/** The share of a line written in the conversation's own script. */
function ownShare(text, lang) {
  const p = scriptProfile(text);
  const letters = p.latin + p.cyrillic + p.cjk;
  if (!letters) return 1;
  if (lang === 'ru') return p.cyrillic / letters;
  if (lang === 'zh') return p.cjk / letters;
  return p.latin / letters;
}

/** Is this one line nothing but the model talking to itself? */
function isPlanLine(line, lang) {
  const text = line.trim();
  if (!text || FENCE.test(text)) return false;
  if (text.length < 12) return false;
  // A line mostly in the conversation's language is content, whatever it opens with.
  if (ownShare(text, lang) >= 0.4) return false;
  return PLAN_CUES.some((re) => re.test(text));
}

/** `Keep ~5 lines.Но, страница…` — a plan and an answer glued at a full stop. */
const glued = (line) => line.replace(/(?<=[.!?])(?=[\u0400-\u04FF\u4E00-\u9FFF])/g, '\n');

/**
 * The reply as the chat should read it.
 *
 * @param {string} text the finished turn's text
 * @param {string} lang the conversation language (`ru`, `en`, `zh`)
 * @returns {{ text: string, dropped: number, foreign: boolean }}
 *   `dropped` is how many lines were removed; `foreign` means what is left still
 *   is not in the conversation's language, which the caller may log.
 */
export function scrubReply(text, lang) {
  const source = String(text ?? '');
  if (!source.trim()) return { text: source, dropped: 0, foreign: false };
  const want = normalizeLang(lang) || 'en';
  // An English conversation has nothing to strip: the cues are English, and the
  // same words are how an English answer legitimately begins.
  if (want === 'en') return { text: source, dropped: 0, foreign: !speaksLang(source, want) };

  const kept = [];
  let dropped = 0;
  let fenced = false;
  for (const raw of source.split(/\r?\n/)) {
    for (const line of raw.split('\n').flatMap((one) => glued(one).split('\n'))) {
      if (FENCE.test(line)) {
        fenced = !fenced;
        kept.push(line);
        continue;
      }
      if (!fenced && isPlanLine(line, want)) {
        dropped += 1;
        continue;
      }
      // `Mention: /help отвечает на языке темы` — the label is plan, the sentence
      // after it is the answer. Drop the label, keep the sentence.
      if (!fenced && PLAN_LABEL.test(line) && ownShare(line.replace(PLAN_LABEL, ''), want) >= 0.4) {
        kept.push(line.replace(PLAN_LABEL, ''));
        continue;
      }
      kept.push(line);
    }
  }
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd();
  // Never trade an answer for tidiness: if stripping left nothing worth reading
  // (or nothing in the right language), the original goes out.
  if (!cleaned.trim() || !speaksLang(cleaned, want)) {
    return { text: source, dropped: 0, foreign: !speaksLang(source, want) };
  }
  return { text: cleaned, dropped, foreign: false };
}