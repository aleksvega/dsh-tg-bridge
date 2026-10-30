// Voice notes, photos and documents: how a Telegram attachment becomes the text
// a turn reads. Split out of `bridge.mjs` because the download, the transcription
// and the hand-over are one job with three failure modes of its own.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DIR } from './paths.mjs';
import { config, log } from './state.mjs';
import { token } from './secrets.mjs';
import { t } from './i18n.mjs';
import { downloadFile, send, tg } from './telegram.mjs';
import { inlineText } from './media-text.mjs';
import { ensureProfile } from './profiles.mjs';
/**
 * Which backend reads the audio: `voice.provider` when the config names one, and
 * otherwise the shape of the config itself, so an install that only has the old
 * keys keeps working across an update. Three shapes, chosen by the person:
 *
 *   - `script`  — a local faster-whisper script (`voice.python` + `voice.script`);
 *   - `command` — any whisper.cpp-style CLI (`voice.command` + `voice.args`);
 *   - `openai`  — any OpenAI-compatible `/audio/transcriptions` endpoint:
 *     OpenAI, Groq, DeepInfra, a local vLLM or `whisper.cpp` server, and whatever
 *     else speaks the same request. `voice.baseUrl` + `voice.model` + a key.
 *
 * The point of `openai` is that nobody is married to the model this repo happened
 * to install: the endpoint and the model name are fields, not code.
 */
export function voiceProvider(voice = {}) {
  const named = String(voice.provider || '').toLowerCase();
  if (named === 'script' || named === 'command' || named === 'openai') return named;
  if (voice.python && voice.script) return 'script';
  if (voice.baseUrl && voice.model) return 'openai';
  if (voice.command) return 'command';
  return '';
}

/** Whether this config can read audio at all — used before offering to. */
export function voiceConfigured(voice = {}) {
  const provider = voiceProvider(voice);
  if (provider === 'openai') {
    // The name of the variable is not the key: a config that only sets
    // `apiKeyEnv` is still missing the value, and pretending otherwise turns
    // "not set up" into a failed request.
    return Boolean(voice.model && (voice.apiKey || (voice.apiKeyEnv && process.env[voice.apiKeyEnv])));
  }
  if (provider === 'script') return Boolean(voice.python && voice.script);
  if (provider === 'command') return Boolean(voice.command);
  return false;
}

export function transcribe(file, voice = {}) {
  const provider = voiceProvider(voice);
  if (provider === 'openai') return transcribeHttp(file, voice);
  if (provider === 'script' || provider === 'command') return transcribeLocal(file, voice, provider === 'script');
  return Promise.resolve({ text: '', error: 'no speech backend: set voice.provider to script, command or openai' });
}

/**
 * A hosted or self-hosted endpoint that answers the OpenAI transcription request.
 * The body is assembled here instead of in a dependency: it is one multipart form.
 */
async function transcribeHttp(file, voice) {
  const base = String(voice.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = voice.apiKey || process.env[voice.apiKeyEnv || ''] || '';
  // The message goes into the chat, so it names the setting, never the value.
  if (!key) return { text: '', error: `no key for ${base}: set voice.apiKey or voice.apiKeyEnv` };
  let audio;
  try {
    audio = readFileSync(file);
  } catch (error) {
    return { text: '', error: `cannot read the audio: ${error.code || error.message}` };
  }
  const form = new FormData();
  form.set('file', new Blob([audio]), basename(file));
  form.set('model', voice.model);
  if (voice.language && voice.language !== 'auto') form.set('language', voice.language);
  let res;
  try {
    res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(voice.timeoutMs || 120000),
    });
  } catch (error) {
    log(`voice http: ${base} ${error.name || error.message}`);
    return { text: '', error: error.name === 'TimeoutError' ? 'the speech endpoint timed out' : 'the speech endpoint did not answer' };
  }
  const raw = await res.text();
  if (!res.ok) {
    // Some providers put a readable reason in the body ("model not found", "bad
    // key"); keep it short and log it without the key or the audio.
    log(`voice http ${res.status} from ${base}: ${raw.slice(0, 200)}`);
    return { text: '', error: `the speech endpoint answered ${res.status}` };
  }
  let text = '';
  try {
    text = String(JSON.parse(raw).text || '');
  } catch {
    // `response_format=text` and a few servers answer with the transcript itself.
    text = raw;
  }
  return { text: text.trim(), error: '' };
}

/** The local shapes: spawn an interpreter with our script, or a whisper CLI. */
function transcribeLocal(file, voice, useScript) {
  const command = useScript ? voice.python : voice.command;
  // The interpreter and the script are named by absolute path or not at all. A
  // bare `python` is looked up on PATH *and* in the working directory, so a file
  // dropped next to the install could answer for the interpreter; the same field
  // hand-edited in `config.json` would point transcription at any program. A
  // whisper.cpp-style `command` stays exempt: `whisper-cli` on PATH is the normal
  // way to install it, and it is not an interpreter that will run our script.
  if (useScript && (!isAbsolute(command) || !isAbsolute(voice.script))) {
    log(`voice: python=${command} script=${voice.script} — both must be absolute`);
    return Promise.resolve({ text: '', error: 'voice.python and voice.script must be absolute paths' });
  }
  const cwd = voice.cwd || DIR;
  // A cwd that does not exist is a typo, and a spawn error names the file rather
  // than the setting that is actually wrong.
  if (voice.cwd && !(existsSync(cwd) && statSync(cwd).isDirectory())) {
    log(`voice: cwd=${cwd} is not a directory`);
    return Promise.resolve({ text: '', error: 'voice.cwd is not a directory' });
  }
  // `{out}` is a temp path the engine may write to: whisper.cpp is not the only
  // program people run — Vosk, WhisperX, GigaAM wrappers and plain ffmpeg chains
  // all exist, and most of them either print the text or write it to a file given
  // on the command line. Both shapes fit in a template, so the config stays data.
  const out = join(tmpdir(), `dsh-voice-${Date.now()}-${process.pid}`);
  const fill = (value) => String(value).replaceAll('{file}', file).replaceAll('{out}', out);
  const args = useScript
    ? [
        voice.script,
        file,
        '--model', voice.model || 'small',
        '--language', voice.language || 'auto',
        '--beam', String(voice.beam ?? 1),
        '--threads', String(voice.threads ?? 0),
      ]
    : (voice.args ?? []).map(fill);
  if (!useScript && !(voice.args ?? []).some((arg) => String(arg).includes('{file}'))) args.push(file);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: voice.cwd || DIR,
      windowsHide: true,
      env: { ...process.env },
    });
    if (voice.timeoutMs) {
      const timer = setTimeout(() => child.kill(), voice.timeoutMs);
      child.on('close', () => clearTimeout(timer));
    }
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (buf) => { stdout += buf; });
    child.stderr.on('data', (buf) => { stderr += buf; });
    child.on('error', (err) => resolve({ text: '', error: `${command}: ${err.message}` }));
    child.on('close', (code) => {
      let text = '';
      if (!useScript && voice.output === 'file') {
        // The engine wrote the transcript where the template said; the file is
        // removed with the temp path afterwards, so the person's inbox stays clean.
        const target = fill(voice.outputFile || '{out}');
        try {
          text = readFileSync(target, 'utf8').trim();
        } catch (error) {
          resolve({ text: '', error: `${basename(command)} wrote no transcript to ${basename(target)}: ${error.code || error.message}` });
          return;
        }
        try { unlinkSync(target); } catch {}
      } else if (!useScript && voice.output === 'json') {
        // {"text": "…"} is the common shape; Vosk answers {"result": [{text}…]}.
        try {
          const data = JSON.parse(stdout);
          text = String(data.text ?? (Array.isArray(data.result) ? data.result.map((r) => r.text || '').join(' ') : ''));
        } catch {
          text = '';
        }
        if (!text) text = stdout.trim();
      } else {
        // whisper.cpp writes timestamps and `[BLANK_AUDIO]` markers; keep only speech.
        text = stdout
          .split(/\r?\n/)
          .map((line) => line.replace(/^\s*\[[\d:.,\s>-]+\]\s*/, '').replace(/\[BLANK_AUDIO\]/gi, '').trim())
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      resolve({ text: text.replace(/\s+/g, ' ').trim(), error: code === 0 ? '' : `${voice.command} exit ${code}: ${stderr.trim().slice(-300)}` });
    });
  });
}

/** <audio file> -> transcript, wrapping every failure in a spoken-to text message. */
export async function voiceToText(msg, voice) {
  const media = msg.voice || msg.audio || msg.document || msg.video_note;
  const file_id = media?.file_id;
  if (!file_id) return { text: '', error: 'no audio file in message' };
  // Voice notes are Opus-in-OGG: the extension follows the source so the
  // decoder picks the right container.
  const ext = msg.voice ? 'ogg' : msg.audio ? (msg.audio.mime_type?.includes('wav') ? 'wav' : 'mp3') : 'ogg';
  const path = await downloadFile(file_id, `voice-${Date.now()}.${ext}`);
  const result = await transcribe(path, voice);
  try { unlinkSync(path); } catch {}
  return result;
}






/**
 * Turn a voice note or an audio file into text, echoing the transcript into the
 * chat so the person sees what was understood before the answer lands.
 *
 * Returns '' when nothing was recognised: the failure is already reported in
 * the chat by then, so callers only have to stop.
 */
export async function readVoiceIntoText(msg, chatId, threadId, lang) {
  // Status line first, then replace it with the transcript. One message that
  // visibly turns "🎤 Расшифровываю…" into "🎤 <текст>" tells the person the
  // audio is being read and, when it is done, exactly what was understood —
  // before the agent's reply lands.
  let statusId = 0;
  if (config.voice?.echo !== false) {
    try {
      const res = await tg('sendMessage', {
        chat_id: chatId,
        text: t(lang, 'msg.transcribing'),
        disable_web_page_preview: true,
        ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        ...(msg.message_id ? { reply_to_message_id: msg.message_id } : {}),
      });
      statusId = res.message_id;
    } catch (error) {
      log(`voice status failed: ${error.message}`);
    }
  }
  const editOrSend = async (shown, fallback) => {
    if (statusId) {
      await tg('editMessageText', { chat_id: chatId, message_id: statusId, text: shown })
        .catch((err) => log(`voice status edit failed: ${err.message}`));
    } else if (config.voice?.echo !== false) {
      await send(chatId, fallback, threadId, msg.message_id);
    }
  };
  let heard = '';
  let error = '';
  try {
    ({ text: heard, error } = await voiceToText(msg, config.voice));
  } catch (err) {
    const fail = t(lang, 'msg.voiceDownloadFailed', { err: err.message });
    await editOrSend(`⚠️ ${fail}`, fail);
    return '';
  }
  if (!heard) {
    const fail = t(lang, 'msg.voiceNotRecognized', { detail: error ? `: ${error}` : '' });
    await editOrSend(`⚠️ ${fail}`, fail);
    return '';
  }
  log(`voice -> text len=${heard.length}${error ? ` (warn: ${error})` : ''}`);
  const preview = heard.length > 1200 ? `${heard.slice(0, 1200)}…` : heard;
  if (statusId || config.voice?.echo !== false) await editOrSend(`🎤 ${preview}`, `🎤 ${preview}`);
  return heard;
}

/**
 * A transcript as the turn should read it: the words, plus the fact that they
 * came out of a speech recogniser.
 *
 * Without the note the model treats a misheard name as a deliberate word and
 * answers the wrong question — "dodge" heard as "дождь" turns a car into
 * weather. The note asks for a question where the guessing would start, and it
 * is part of the prompt rather than the chat: the person already sees the
 * transcript echoed above the reply.
 */
export function voicePromptText(heard, lang) {
  return t(lang, 'prompt.voice', { text: String(heard ?? '').trim() });
}

/**
 * Attachments -> the prompt text that hands them to the turn.
 *
 * Takes a list because Telegram delivers an album as several messages sharing
 * one `media_group_id`; the bridge collects them and builds a single hand-over.
 * Every supported attachment becomes the same kind of text here, so a normal
 * turn and a mid-turn steer describe a file identically. `extraArgs` carries
 * per-turn flags (the opt-in vision overlay); a steer cannot apply them to a
 * running turn and leaves it empty.
 */
export async function mediaPrompt(msgs, chatId, threadId, lang, opts = {}) {
  const list = Array.isArray(msgs) ? msgs : [msgs];
  // `enabled` is the master switch; `voiceConfigured` knows every backend shape,
  // so a key-only (hosted) setup is not mistaken for a missing one.
  const voiceOn = Boolean(config.voice?.enabled) && voiceConfigured(config.voice);
  const parts = [];
  let extraArgs = [];
  /** Profile the turn must run on (only an opt-in photo overlay overrides it). */
  let profile = '';
  let caption = '';
  let photo = false;
  // A voice note with no backend used to be dropped without a word: the person
  // saw the bot ignore them, and nothing said the engine was missing. Once per
  // batch is enough — an album of clips must not repeat the same line.
  let voiceTold = false;
  for (const msg of list) {
    if (!caption && (msg.caption || '').trim()) caption = msg.caption.trim();
    if (msg.voice || msg.audio) {
      if (!voiceOn) {
        log('audio ignored: voice transcription is off or misconfigured');
        if (!voiceTold) {
          voiceTold = true;
          await send(chatId, t(lang, 'msg.voiceOff'), threadId);
        }
        continue;
      }
      const heard = await readVoiceIntoText(msg, chatId, threadId, lang);
      if (heard) parts.push(voicePromptText(heard, lang));
      continue;
    }
    // An audio file sent as a document is a voice note with a different
    // wrapper: transcribe it instead of handing over a path nobody can listen to.
    if (msg.document?.mime_type?.startsWith('audio/') && voiceOn) {
      const heard = await readVoiceIntoText({ ...msg, audio: msg.document }, chatId, threadId, lang);
      if (heard) parts.push(voicePromptText(heard, lang));
      continue;
    }
    // Photo handling: the turn's own model reads the file through `read_image`.
    // A headless turn on the plain `headless` profile read the Chinese captions
    // off a 720×1560 screenshot and answered with them verbatim, so the vision
    // overlay is opt-in (`vision.enabled`) instead of being applied to every
    // photo — switching each one to a second, billed model was the workaround
    // for a text-only default that no longer applies.
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const file = await tg('getFile', { file_id: fileId });
      const path = join(DIR, `photo-${Date.now()}-${parts.length}.jpg`);
      const bin = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      writeFileSync(path, Buffer.from(await bin.arrayBuffer()));
      parts.push(t(lang, 'prompt.photo', { path }));
      photo = true;
      if (config.vision?.enabled && config.vision?.patch && existsSync(config.vision.patch)) {
        // The desktop host CLI dropped `--patch` (it answers "unknown option"
        // and exits 1 with no output), so the overlay is materialised once as a
        // profile carrying the same model and the turn switches profile instead.
        const visionProfile = ensureProfile(config.vision.patch);
        if (visionProfile) {
          profile = visionProfile;
          log(`photo turn uses profile ${visionProfile} (overlay ${config.vision.patch})`);
        }
      }
      continue;
    }
    // Documents (PDF, zip, source, csv), video and video notes: save under
    // inbox/ and hand the path to the turn. Text-like files are also pasted in
    // as content, so a steer can use them without a tool round-trip.
    const doc = msg.document || msg.video || msg.video_note || msg.animation;
    if (!doc) continue;
    const safe = (doc.file_name || `file-${Date.now()}`).replace(/[^\w.\-]+/g, '_');
    const inbox = join(DIR, 'inbox');
    mkdirSync(inbox, { recursive: true });
    const path = join(inbox, `${Date.now()}-${parts.length}-${safe}`);
    const file = await tg('getFile', { file_id: doc.file_id });
    const bin = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!bin.ok) throw new Error(`document download failed: ${bin.status}`);
    writeFileSync(path, Buffer.from(await bin.arrayBuffer()));
    const type = doc.mime_type || 'unknown';
    const size = doc.file_size || '?';
    const body = msg.document ? inlineText(path, safe) : '';
    parts.push(body
      ? t(lang, 'prompt.fileText', { path, type, size, body })
      : t(lang, 'prompt.file', { path, type, size }));
    log(`document saved ${path} bytes=${doc.file_size || 0}${body ? ` inline=${body.length}` : ''}`);
  }
  let text = parts.filter(Boolean).join('\n\n');
  // A steer cannot apply the vision overlay to a turn that is already running,
  // so the model gets a path and an honest line instead of a silently
  // unreadable image. If the turn died while the file was being fetched, the
  // text is about to become a turn of its own — and there the image *is*
  // readable, so the disclaimer would be a lie.
  const liveNow = opts.stillRunning ? opts.stillRunning() : true;
  if (text && photo && opts.steer && liveNow) text += `\n\n${t(lang, 'prompt.photoMidTurn')}`;
  if (text && caption) text += `\n\n${t(lang, 'prompt.note', { note: caption })}`;
  return { text, extraArgs, profile };
}

