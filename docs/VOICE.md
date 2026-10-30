# Voice notes and audio files

The bridge does not ship a speech model and does not care which one you use. It
sends the downloaded audio to **your** transcriber and puts the text into the
turn. Three shapes exist; pick whichever fits the machine the bridge runs on.

Everything lives in the `voice` block of `config.json` (next to `bridge.mjs`).
`"enabled": true` is the master switch in every shape.

| `voice.provider` | What it runs | Needs |
| --- | --- | --- |
| `script` | a local Python script (faster-whisper, WhisperX, your own) | `voice.python` + `voice.script`, both absolute paths |
| `command` | any program that prints or writes the transcript | `voice.command` + `voice.args` |
| `openai` | any OpenAI-compatible `/audio/transcriptions` HTTP endpoint | `voice.baseUrl` + `voice.model` + a key |

If `provider` is absent the shape is guessed from the keys present, in that
order, so an install that only has the old fields keeps working.

## Anything local: `command`

`voice.command` is the executable, `voice.args` is the argument template.
`{file}` becomes the downloaded audio path, `{out}` becomes a temporary path you
may write to. `voice.output` says where the transcript comes from:

- `stdout` (default) — printed text. whisper.cpp timestamps and `[BLANK_AUDIO]`
  markers are stripped.
- `json` — stdout is JSON; `{"text": "…"}` and Vosk's `{"result": [{"text": …}]}`
  are understood.
- `file` — the program wrote it; `voice.outputFile` is the template, default
  `{out}`.

whisper.cpp:

```json
{ "voice": { "enabled": true, "provider": "command",
  "command": "whisper-cli", "args": ["-m", "D:/models/ggml-small.bin", "-f", "{file}", "-otxt", "-of", "{out}"],
  "output": "file", "outputFile": "{out}.txt", "language": "ru", "timeoutMs": 180000 } }
```

Vosk (streams JSON):

```json
{ "voice": { "enabled": true, "provider": "command",
  "command": "vosk-transcriber", "args": ["-i", "{file}", "-l", "ru"],
  "output": "json", "timeoutMs": 180000 } }
```

A wrapper of your own — GigaAM, WhisperX, an ffmpeg chain — is the same shape:
make it take a file path, make it print one line of text, and point
`voice.command` at it.

## Local Python: `script`

```json
{ "voice": { "enabled": true, "provider": "script",
  "python": "C:/Users/me/.venv-whisper/Scripts/python.exe",
  "script": "C:/Users/me/.dsh/tg-bridge/transcribe.py",
  "model": "small", "language": "ru", "beam": 1, "threads": 6, "timeoutMs": 180000 } }
```

Both paths must be absolute: a bare `python` is looked up on `PATH` **and** in the
working directory, which is how a file dropped next to the install gets to answer
for the interpreter. `transcribe.py` in this repo takes the audio path, then
`--model`, `--language`, `--beam`, `--threads`, and prints the text.

## Hosted or self-hosted API: `openai`

```json
{ "voice": { "enabled": true, "provider": "openai",
  "baseUrl": "https://api.groq.com/openai/v1", "model": "whisper-large-v3-turbo",
  "apiKeyEnv": "GROQ_API_KEY", "language": "ru", "timeoutMs": 60000 } }
```

- `baseUrl` defaults to `https://api.openai.com/v1`; the bridge POSTs to
  `<baseUrl>/audio/transcriptions`.
- `model` is whatever that provider calls it — nothing here is OpenAI-specific.
- The key comes from `apiKeyEnv` (an environment variable, preferred) or
  `apiKey`. A key in the config file is a key in a file: the env variable is the
  better default, and neither is ever printed to the chat.
- A local server works the same way: point `baseUrl` at
  `http://127.0.0.1:8000/v1` and leave the key as any placeholder string.

## What the person sees

- The status line `🎤 Transcribing…` turns into the transcript before the answer.
- If nothing was recognised, the message says so instead of going quiet.
- If no backend is configured, the bridge answers with what is missing and where
  to read (this file) — it does not swallow the voice note silently.

## Photos and documents

Voice is the only attachment that needs a model. A photo goes to the turn as a
path (plus an optional `vision` overlay profile); a document, archive or video is
saved under `inbox/` and handed over as a path, with text-like files pasted in so
a mid-turn steer can read them too. That part works on a fresh install with an
empty `voice` block.

## Checking your setup

Send the bridge a voice note. A misconfiguration answers in the chat with the
missing field name, and the same detail lands in `bridge.log`:

```
voice: python=python script=C:\...\transcribe.py — both must be absolute
voice http 401 from https://api.groq.com/openai/v1: {"error": ...}
voice: cwd=D:\nope is not a directory
```
