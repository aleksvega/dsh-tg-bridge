// Voice notes, photos and documents: how a Telegram attachment becomes the text
// a turn reads. Split out of `bridge.mjs` because the download, the transcription
// and the hand-over are one job with three failure modes of its own.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from './paths.mjs';
import { config, log } from './state.mjs';
import { token } from './secrets.mjs';
import { t } from './i18n.mjs';
import { downloadFile, send, tg } from './telegram.mjs';
import { inlineText } from './media-text.mjs';
import { ensureProfile } from './profiles.mjs';
/**
 * Transcribe a local audio file with the speech backend from config.
 *
 * Two shapes are supported:
 *   - faster-whisper script: `voice.python` + `voice.script` + `voice.model`
 *     (the local setup: `~/.venv-whisper`, models from the HF cache);
 *   - any whisper.cpp-style CLI: `voice.command` + `voice.args`, with `{file}`.
 * Either way the transcript comes back on stdout, diagnostics on stderr.
 */
export function transcribe(file, voice) {
  const useScript = Boolean(voice.python && voice.script);
  const command = useScript ? voice.python : voice.command;
  const args = useScript
    ? [
        voice.script,
        file,
        '--model', voice.model || 'small',
        '--language', voice.language || 'auto',
        '--beam', String(voice.beam ?? 1),
        '--threads', String(voice.threads ?? 0),
      ]
    : (voice.args ?? []).map((arg) => String(arg).replaceAll('{file}', file));
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
      // whisper.cpp writes timestamps and `[BLANK_AUDIO]` markers; keep only speech.
      const text = stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\[[\d:.,\s>-]+\]\s*/, '').replace(/\[BLANK_AUDIO\]/gi, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      resolve({ text, error: code === 0 ? '' : `${voice.command} exit ${code}: ${stderr.trim().slice(-300)}` });
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
  const voiceReady = Boolean(config.voice?.python && config.voice?.script) || Boolean(config.voice?.command);
  const voiceOn = Boolean(config.voice?.enabled) && voiceReady;
  const parts = [];
  let extraArgs = [];
  /** Profile the turn must run on (only an opt-in photo overlay overrides it). */
  let profile = '';
  let caption = '';
  let photo = false;
  for (const msg of list) {
    if (!caption && (msg.caption || '').trim()) caption = msg.caption.trim();
    if (msg.voice || msg.audio) {
      if (!voiceOn) {
        log('audio ignored: voice transcription is off or misconfigured');
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

