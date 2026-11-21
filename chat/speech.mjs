// Speaking an answer out loud, when the person cannot read right now.
//
// The text always goes first and never waits for the voice: a TTS that hangs,
// a missing engine or a provider outage must cost the sound, not the answer.
// Every failure here is logged and swallowed for that reason.
//
// The engine is not built in. `speech.provider` names what to run and
// `speech.args` carries its arguments, so a local Piper model and a network
// voice are the same code path — the project already decided (task 83) that
// voice is a door, not a feature of the bridge.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendVoice } from './telegram.mjs';

const run = promisify(execFile);

/**
 * A male voice per language, used when the config names none.
 *
 * The person's own requirement: "мужской голос, хороший". These are the
 * voices that were actually checked on this machine; an unknown language
 * falls back to the first entry, not to silence.
 */
export const DEFAULT_VOICES = {
  ru: 'ru-RU-DmitryNeural',
  en: 'en-US-GuyNeural',
  zh: 'zh-CN-YunjianNeural',
};

/** One voice note is a message; a longer answer is several, not a shorter one. */
export const MAX_SPEECH_CHARS = 1200;

/** The config block, with the defaults this module promises. */
export function speechConfig(config) {
  const raw = config?.speech || {};
  return {
    provider: raw.provider || 'edge-tts',
    // The two fields `providerArgs` reads for a non-edge engine. They were
    // documented ("a local Piper install is config, not a code change") but
    // never copied here, so any provider other than edge-tts spawned itself
    // by name and failed with ENOENT.
    command: raw.command,
    args: Array.isArray(raw.args) ? raw.args : undefined,
    python: raw.python || 'python',
    ffmpeg: raw.ffmpeg || 'ffmpeg',
    // An engine that already speaks OGG/Opus skips the ffmpeg conversion; the
    // flag was documented before it was read, which made it dead config.
    ogg: raw.ogg === true,
    maxChars: Number(raw.maxChars) > 0 ? Number(raw.maxChars) : MAX_SPEECH_CHARS,
    timeoutMs: Number(raw.timeoutMs) > 0 ? Number(raw.timeoutMs) : 120000,
    voices: { ...DEFAULT_VOICES, ...(raw.voices || {}) },
  };
}

/** Is the voice on for this topic, and in which voice? */
export function speechOf(state, key, config, lang = 'ru') {
  const settings = (state?.speech && state.speech[key]) || {};
  const cfg = speechConfig(config);
  return {
    on: settings.on === true,
    voice: settings.voice || cfg.voices[lang] || cfg.voices.ru,
  };
}

/** Turn the voice on or off for one topic. Returns the new setting. */
export function setSpeech(state, key, patch, config, lang = 'ru') {
  if (!state.speech) state.speech = {};
  const before = speechOf(state, key, config, lang);
  const next = { ...before, ...patch };
  state.speech[key] = next;
  return next;
}

/**
 * What the ear gets, from what the eye got.
 *
 * Code blocks, markup and tables are not speech: reading `**` aloud or spelling
 * out a pipe-separated row makes the message worse than silence. Emoji are
 * dropped for the same reason; a voice model pronounces "🙂" as a pause.
 *
 * Nothing is cut here: what this returns is the whole answer, and `speechParts`
 * decides how it is divided into notes. A cut in this function was the defect
 * this module grew out of — a 3000-char answer arrived as its first 1155
 * characters, and the person heard a reply that ended mid-thought.
 */
export function forSpeech(text) {
  let out = String(text || '');
  // A fenced block is a document the person will read, not listen to.
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/`([^`]*)`/g, '$1');
  // Links keep their words, lose their address: nobody wants a URL spelled out.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  out = out.replace(/https?:\/\/\S+/g, ' ');
  out = out.replace(/^\s*\|.*\|\s*$/gm, ' ');
  out = out.replace(/[*_~#>]+/g, ' ');
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The answer as a list of notes, each a thing a person can listen to whole.
 *
 * Every note ends on a sentence when the window has one, else on a word, and
 * never in the middle of a word; the last note is whatever remains, even short.
 * The concatenation of the notes is always the full cleaned answer — a tail
 * that is silently dropped is half an answer pretending to be one.
 */
export function speechParts(text, maxChars = MAX_SPEECH_CHARS) {
  const full = forSpeech(text);
  if (!full) return [];
  if (full.length <= maxChars) return [full];
  const parts = [];
  let rest = full;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    if (stop < maxChars * 0.5) stop = window.lastIndexOf(' ');
    if (stop <= 0) stop = maxChars;
    parts.push(rest.slice(0, stop + 1).trim());
    rest = rest.slice(stop + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/** The arguments for one provider run. Kept separate so a test can read them. */
export function providerArgs(cfg, { text, mp3 }) {
  if (cfg.provider === 'edge-tts') {
    return {
      command: cfg.python,
      args: ['-m', 'edge_tts', '--voice', cfg.voice || DEFAULT_VOICES.ru, '--text', text, '--write-media', mp3],
    };
  }
  // Any other provider receives the text and the target file through the same
  // two placeholders, so a local Piper install is config, not a code change.
  // `{voice}` is the third: `/voice <name>` sets the voice per topic, and an
  // engine that owns its own voices (Piper maps them to model files) needs that
  // name or the card would confirm a change nothing makes.
  const args = (cfg.args || ['{text}', '{out}']).map((part) =>
    String(part)
      .replace('{text}', text)
      .replace('{out}', mp3)
      .replace('{voice}', cfg.voice || ''));
  return { command: cfg.command || cfg.provider, args };
}

/**
 * Say the answer out loud, if this topic asked for it.
 *
 * A long answer is several voice notes sent in order, never one note with the
 * rest of the answer dropped. Each note is a full engine run, so one hanging
 * engine costs that note, not the notes after it, and never the answer, which
 * the caller already sent as text.
 *
 * `runner` and `sender` are injectable so the tests can prove the sequence
 * without spawning a real engine or the network.
 *
 * @returns {Promise<boolean>} whether at least one voice note was sent
 */
export async function speak({ chatId, threadId, state, key, text, config, lang = 'ru', log = () => {}, runner = run, sender = sendVoice }) {
  const setting = speechOf(state, key, config, lang);
  if (!setting.on) return false;
  const cfg = speechConfig(config);
  const parts = speechParts(text, cfg.maxChars);
  if (!parts.length) return false;

  const dir = mkdtempSync(join(tmpdir(), 'dsh-speech-'));
  let sent = 0;
  try {
    for (const [index, part] of parts.entries()) {
      const mp3 = join(dir, `say-${index + 1}.mp3`);
      const ogg = join(dir, `say-${index + 1}.ogg`);
      try {
        // The provider writes `mp3`; a provider that already speaks OGG/Opus
        // (`speech.ogg: true`) skips the conversion and its ffmpeg dependency.
        const target = cfg.ogg ? ogg : mp3;
        const { command, args } = providerArgs({ ...cfg, voice: setting.voice }, { text: part, mp3: target });
        await runner(command, args, { timeout: cfg.timeoutMs, windowsHide: true, maxBuffer: 8 << 20 });
        if (!cfg.ogg) {
          await runner(cfg.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp3,
            '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1', ogg],
          { timeout: cfg.timeoutMs, windowsHide: true });
        }
        await sender(chatId, threadId, ogg);
        sent += 1;
      } catch (error) {
        // Loud in the log, silent in the chat: the text already arrived.
        log(`speech failed for note ${index + 1}/${parts.length} chat=${chatId}: ${String(error?.message ?? error).slice(0, 200)}`);
      }
    }
    if (sent) log(`spoke ${sent}/${parts.length} note(s) ${parts.join('').length} chars in ${setting.voice} chat=${chatId} topic=${threadId ?? 0}`);
    return sent > 0;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir, best effort */ }
  }
}
