// One DSH turn: the CLI child, its output, its clocks, and the map of what is
// running right now.
//
// This is the module `/stop` and `/status` depend on, so it owns the three maps
// rather than reaching into the poller for them. They are exported deliberately:
// a second copy of "which turns are running" is how a bridge ends up with a stop
// button that does nothing.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CLI_JS, EXE } from './paths.mjs';
import { config, log, state } from './state.mjs';
import { providerKeys } from './secrets.mjs';
import { tg } from './telegram.mjs';
import { t } from './i18n.mjs';
import { turnArgs } from './cli-args.mjs';
import { turnOutcome } from './turn-outcome.mjs';

/** Turns currently running, keyed like sessions — `/stop` kills one. */
export const activeTurns = new Map();
/** Session id each running turn actually adopted, learned from its `session` event. */
export const liveSessions = new Map();
/** Wall-clock start of the running turn per session key, for the queue notice. */
export const turnStartedAt = new Map();
/**
 * Turns a person stopped on purpose, keyed like sessions.
 *
 * A killed child exits by signal, so its exit code is `null` and there is no
 * stderr: the turn looked exactly like a crash and the chat said "сбой хода"
 * after `/stop` — an alarming word for the thing the person just asked for. The
 * flag is set by `killTurn` and read once by the close handler.
 */
export const stoppedTurns = new Set();

/**
 * Which profile runs this topic's turns. `/profile <name>` binds one topic to
 * its own plugin set and model; every other topic keeps the install default.
 */
export function profileOf(key) {
  return (state.profiles && state.profiles[key]) || config.profile || 'headless';
}

/** Run one DSH headless turn; resolve {sessionId, text, error}. */
export function runTurn(task, sessionId, key = '', onEvent = null, extraArgs = [], cwd = '', profile = config.profile, lang = config.lang || 'en', env = {}) {
  return new Promise((resolve) => {
    const args = turnArgs({ cli: CLI_JS, profile, extraArgs, sessionId, task });
    const child = spawn(EXE, args, {
      // Per-topic project directory: a topic can be bound to one repository so
      // "work in my-app" stops meaning "cd in every command".
      cwd: cwd && existsSync(cwd) ? cwd : config.cwd,
      env: {
        ...process.env,
        DSH_TG_KEY: key,
        DSH_TG_CHAT: String(key).split(':')[0] || '',
        DSH_TG_THREAD: String(key).split(':')[1] || '0',
        // Per-turn extras: the path of this turn's note file, so `say.mjs`
        // never has to guess which topic a line belongs to.
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        // Provider keys the profile cannot resolve on its own. Configured per
        // install (`providerKeys`, see config.example.json); a key listed in
        // `~/.dsh/.credentials.yaml` is passed by its own name.
        ...providerKeys(config),
      },
      windowsHide: true,
    });
    if (key) activeTurns.set(key, child);
    let stdout = '';
    let stderr = '';
    let sid = sessionId || '';
    let finalText = '';
    const timer = config.turnTimeoutMs > 0 ? setTimeout(() => child.kill(), config.turnTimeoutMs) : null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (buf) => {
      stdout += buf;
      // Any byte from the CLI is proof of life: the model may think for minutes
      // before the next structured event, and a silent turn is not a hung one.
      if (onEvent) { try { onEvent({ type: 'activity' }); } catch {} }
      let idx;
      while ((idx = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, idx).trim();
        stdout = stdout.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'session' && ev.sessionId) sid = ev.sessionId;
          if (ev.type === 'final' && typeof ev.text === 'string') finalText = ev.text;
          if (ev.type === 'error') finalText = finalText || t(lang, 'bridge.error.inline', { msg: ev.message || JSON.stringify(ev) });
          // Every event is forwarded so the bridge can show live progress; a
          // silent turn used to look identical to a hung one.
          if (onEvent) {
            try {
              onEvent(ev);
            } catch {}
          }
        } catch {}
      }
    });
    child.stderr.on('data', (buf) => {
      stderr += buf;
      if (onEvent) { try { onEvent({ type: 'activity' }); } catch {} }
    });
    // A missing or moved DSH app used to emit `error` with no listener, which
    // kills the process — every turn, forever. The turn now fails with a line
    // that says which path was expected and how to point the bridge elsewhere.
    child.on('error', (error) => {
      clearTimeout(timer);
      if (key) activeTurns.delete(key);
      const hint = error?.code === 'ENOENT'
        ? t(lang, 'bridge.error.noApp', { path: EXE })
        : t(lang, 'bridge.error.spawn', { msg: error?.message || String(error) });
      log(`turn spawn failed: ${error?.message || error}`);
      resolve({ sessionId: sid, text: '', error: hint });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (key) activeTurns.delete(key);
      // No live process means no agent to steer; a job written now would wait
      // for the next turn instead of the current one.
      if (key) liveSessions.delete(key);
      // A failure keeps the whole diagnostic: the CLI prints the useful phrase
      // ("pending (waiting for service: speechToText)") on the lines AFTER the
      // one-line summary, and trimming early hid the real cause from the chat.
      // `turnOutcome` also knows that a stop is not a failure and that a killed
      // child has no exit code, which is how `{code}` once reached the screen.
      const outcome = turnOutcome({
        code,
        stopped: key ? stoppedTurns.delete(key) : false,
        stderr,
        stdout,
        finalText,
        lang,
      });
      resolve({ sessionId: sid, text: outcome.text, error: outcome.error, stopped: outcome.stopped });
    });
  });
}

export async function typingLoop(chatId, threadId, stopFlag) {
  while (!stopFlag.done) {
    try {
      const body = { chat_id: chatId, action: 'typing' };
      if (threadId > 0) body.message_thread_id = threadId;
      await tg('sendChatAction', body);
    } catch {}
    await new Promise((r) => setTimeout(r, 4500));
  }
}

/**
 * Turn runner with an IDLE deadline and a live progress sink.
 *
 * A fixed wall-clock limit is wrong for this work: a real build or a long
 * research pass legitimately outlives any short cap, and killing it at 7
 * minutes threw away finished work (the 422s failure on 2026-10-21). What
 * actually matters is SILENCE — a turn that emits no event for N seconds is
 * stuck. Every CLI event therefore refreshes the deadline.
 *
 * Returns {sessionId, text, error}: the error carrying "no activity" when the
 * idle window expires.
 */
export function runTurnLive(task, sessionId, key, options = {}) {
  const idleMs = Number(options.idleMs ?? config.turnIdleMs ?? 300000);
  // A tool can legitimately run for many minutes (install, build, test suite)
  // while the model emits nothing at all. Silence during a tool call is work,
  // not a hang, so it gets its own much longer window.
  const toolIdleMs = Number(options.toolIdleMs ?? config.turnToolIdleMs ?? 30 * 60 * 1000);
  const hardMs = Number(options.hardMs ?? config.turnTimeoutMs ?? 1800000);
  const onEvent = options.onEvent;

  return new Promise((resolve) => {
    let done = false;
    let idleTimer;
    let lastType = '';
    let sessionSeen = sessionId || '';

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      resolve(value);
    };

    const armIdle = (windowMs = idleMs) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Silence is NOT a hang: the model can think for many minutes, and a
        // long task may take hours. Keep the turn alive, refresh the visible
        // clock so the person sees progress, and re-arm.
        log(`turn quiet ${Math.round(windowMs / 1000)}s for ${key}; heartbeat`);
        if (options.onHeartbeat) { try { options.onHeartbeat(); } catch {} }
        armIdle(windowMs);
      }, windowMs);
    };

    // Generous absolute ceiling: protects the queue from a turn that keeps
    // emitting trivia forever, without punishing real long work.
    // Optional absolute ceiling. 0 (the default now) means "no cap": a real
    // task may take hours, and the turn ends when the CLI exits or the person
    // presses Стоп — not when a timer decides.
    const hardTimer = hardMs > 0 ? setTimeout(() => {
      log(`turn hard cap ${Math.round(hardMs / 60000)}min for ${key}; aborting`);
      finish({
        sessionId: sessionSeen,
        text: '',
        reason: 'timeout',
        minutes: Math.round(hardMs / 60000),
        error: `turn exceeded ${Math.round(hardMs / 60000)} min`,
      });
      if (options.onAbort) options.onAbort();
    }, hardMs) : null;

    armIdle();

    runTurn(task, sessionId, key, (event) => {
      if (event.type === 'activity') {
        armIdle(lastType === 'tool_call' ? toolIdleMs : idleMs);
        return;
      }
      lastType = event.type;
      armIdle(event.type === 'tool_call' ? toolIdleMs : idleMs);
      if (event.type === 'session' && event.sessionId) sessionSeen = event.sessionId;
      if (onEvent) {
        try {
          onEvent(event);
        } catch {}
      }
    }, options.extraArgs ?? [], options.cwd ?? '', options.profile || profileOf(key), options.lang ?? config.lang ?? 'en', options.env ?? {})
      .then((result) => finish({ ...result, sessionId: result.sessionId || sessionSeen }))
      .catch((error) => finish({ sessionId: sessionSeen, text: '', error: String(error?.message ?? error) }));
  });
}

/** Kill the CLI child of one turn, if it is still alive. */
export function killTurn(key) {
  const child = activeTurns.get(key);
  if (!child) return false;
  try {
    // Remembered BEFORE the kill: the close handler runs on the next tick and
    // has to know that this exit was asked for. Without the flag a stop is
    // indistinguishable from a crash — same null exit code, same empty stderr.
    if (key) stoppedTurns.add(key);
    child.kill();
    activeTurns.delete(key);
    log(`killed hung turn for ${key}`);
    return true;
  } catch (error) {
    if (key) stoppedTurns.delete(key);
    log(`kill failed for ${key}: ${error.message}`);
    return false;
  }
}
