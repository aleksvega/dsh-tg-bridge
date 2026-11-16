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

/** Longer than this is not a message to listen to, it is a document. */
export const MAX_SPEECH_CHARS = 1200;

/** The config block, with the defaults this module promises. */
export function speechConfig(config) {
  const raw = config?.speech || {};
  return {
    provider: raw.provider || 'edge-tts',
    python: raw.python || 'python',
    ffmpeg: raw.ffmpeg || 'ffmpeg',
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
 */
export function forSpeech(text, maxChars = MAX_SPEECH_CHARS) {
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
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length <= maxChars) return out;
  // Cut at a sentence, not mid-word: a stopped voice sounds like a fault.
  const cut = out.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > maxChars * 0.5 ? cut.slice(0, stop + 1) : cut).trim();
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
  const args = (cfg.args || ['{text}', '{out}']).map((part) =>
    String(part).replace('{text}', text).replace('{out}', mp3));
  return { command: cfg.command || cfg.provider, args };
}

/**
 * Say the answer out loud, if this topic asked for it.
 *
 * @returns {Promise<boolean>} whether a voice note was sent
 */
export async function speak({ chatId, threadId, state, key, text, config, lang = 'ru', log = () => {} }) {
  const setting = speechOf(state, key, config, lang);
  if (!setting.on) return false;
  const cfg = speechConfig(config);
  const said = forSpeech(text, cfg.maxChars);
  if (!said) return false;

  const dir = mkdtempSync(join(tmpdir(), 'dsh-speech-'));
  const mp3 = join(dir, 'say.mp3');
  const ogg = join(dir, 'say.ogg');
  try {
    // The provider writes `mp3`; a provider that already speaks OGG/Opus
    // (`speech.ogg: true`) skips the conversion and its ffmpeg dependency.
    const target = cfg.ogg ? ogg : mp3;
    const { command, args } = providerArgs({ ...cfg, voice: setting.voice }, { text: said, mp3: target });
    await run(command, args, { timeout: cfg.timeoutMs, windowsHide: true, maxBuffer: 8 << 20 });
    if (!cfg.ogg) {
      await run(cfg.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp3,
        '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1', ogg],
      { timeout: cfg.timeoutMs, windowsHide: true });
    }
    await sendVoice(chatId, threadId, ogg);
    log(`spoke ${said.length} chars in ${setting.voice} chat=${chatId}`);
    return true;
  } catch (error) {
    // Loud in the log, silent in the chat: the text already arrived.
    log(`speech failed for chat=${chatId}: ${String(error?.message ?? error).slice(0, 200)}`);
    return false;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir, best effort */ }
  }
}
