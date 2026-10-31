// The clocks the bridge owns: goal jobs, agent-set jobs, reminders, schedules.
//
// A turn is a short-lived process, so anything that has to outlive a message
// runs here. Each loop is `unref()`ed: an idle bridge must be able to exit.
import { join } from 'node:path';
import { drainAsetJobs } from './aset-jobs.mjs';
import { drainGoalJobs } from '../work/goals.mjs';
import { t } from '../core/i18n.mjs';
import { DIR } from '../core/paths.mjs';
import { applyAsetJob } from '../profile/profile-view.mjs';
import { config, log, saveState, state } from '../core/state.mjs';
import { sessionKey } from '../core/keys.mjs';
import { claimRows, syntheticMessage } from '../work/schedules.mjs';
import { send, tg } from '../chat/telegram.mjs';
import { redeliver } from './queue.mjs';

export function startJobLoops() {
  // The agent updates the topic goal list by dropping a job file (goal.mjs);
  // the bridge is the only writer of state.json, so there is no lock race.
    const GOAL_DIR = join(DIR, 'goal-jobs');
  setInterval(() => {
    try {
      if (drainGoalJobs(state, GOAL_DIR, join(GOAL_DIR, 'done'))) saveState();
    } catch (error) {
      log(`goal job failed: ${error.message}`);
    }
  }, 2000).unref();

  // `/agentset` dropped as a job by a running turn (aset-jobs.mjs). The apply
  // function is the same one that answers `/agentset` in the chat, so a job and a
  // typed command cannot drift apart.
  const ASET_DIR = join(DIR, 'aset-jobs');
  setInterval(() => {
    try {
      const results = drainAsetJobs(DIR, (job) => applyAsetJob(job));
      for (const result of results) {
        log(`aset job ${result.job?.setId || result.job?.id || '?'} -> ${result.ok ? 'ok' : 'refused'}`);
        if (result.changed) saveState();
        if (result.job?.chatId) {
          Promise.resolve(send(String(result.job.chatId), result.text, Number(result.job.threadId) || 0))
            .catch((error) => log(`aset job answer failed: ${error.message}`));
        }
      }
    } catch (error) {
      log(`aset job failed: ${error.message}`);
    }
  }, 2000).unref();

  // Reminders: a turn is one short-lived process, so the only clock that can
  // outlive a message is this one. A reminder that came due while the bridge was
  // down fires on the first tick after it starts; one created for a topic that
  // has since been deleted still tries, and the delivery error is logged.
  setInterval(() => {
    try {
      const now = Date.now();
      const rows = Array.isArray(state.reminders) ? state.reminders : [];
      const ready = rows.filter((row) => row && Number(row.at) <= now);
      if (ready.length === 0) return;
      const ids = new Set(ready.map((row) => row.id));
      state.reminders = rows.filter((row) => !ids.has(row.id));
      saveState();
      for (const row of ready) {
        Promise.resolve(send(String(row.chatId), t(row.lang || config.lang || 'en', 'ctrl.remind.due', { text: row.text }), Number(row.threadId) || 0))
          .then(() => log(`reminder ${row.id} delivered`))
          .catch((error) => log(`reminder ${row.id} delivery failed: ${error.message}`));
      }
    } catch (error) {
      log(`reminder loop failed: ${error.message}`);
    }
  }, 20_000).unref();

  // Schedules: same clock, different rule. A repeating row is never removed — it
  // is *claimed*: `at` moves to the next occurrence in the same `saveState()` that
  // the delivery is based on. That is what makes a missed run fire exactly once
  // after a restart instead of once per missed day, and what keeps two ticks (or
  // two bridge processes on one state file) from sending the same morning twice.
  setInterval(() => {
    void runScheduleTick().catch((error) => log(`schedule tick failed: ${error.message}`));
  }, 20_000).unref();
}

/**
 * Deliver every schedule that is due, and move each one to its next occurrence.
 *
 * Claim-then-deliver, in that order and in one save: the persisted `at` is the
 * only thing that stops a second firing, so it must never wait for Telegram. A
 * delivery that fails is logged and not retried — retrying a turn the agent may
 * already have started is worse than one missed message.
 */
export async function runScheduleTick(now = Date.now(), deps = {}) {
  const shared = deps.state ?? state;
  const save = deps.save ?? saveState;
  const note = deps.log ?? log;
  const deliver = deps.deliver ?? ((row) => {
    const threadId = Number(row.threadId) || 0;
    const owner = config.allowedUserIds?.[0] ?? row.chatId;
    return redeliver(sessionKey(Number(row.chatId), threadId), syntheticMessage(row, owner));
  });
  const probe = deps.probe ?? probeTopic;

  const rows = Array.isArray(shared.schedules) ? shared.schedules : [];
  const claimed = claimRows(rows, now);
  if (claimed.claimed.length === 0) return [];
  shared.schedules = claimed.rows;
  save();

  const ready = [];
  for (const row of claimed.claimed) {
    const threadId = Number(row.threadId) || 0;
    // A topic can be deleted between the schedule and its morning. The turn path
    // would report that as a failed progress message and go on to run the turn
    // anyway; probing first turns it into one loud line and a clean skip.
    try {
      await probe(row, threadId);
      ready.push(row);
    } catch (error) {
      note(`schedule ${row.id} skipped: topic ${threadId} of chat ${row.chatId} is gone (${error.message})`);
    }
  }

  // All at once: `redeliver` resolves when the *turn* is done, which can be
  // minutes, so awaiting the rows one by one would start the second 09:00
  // schedule only after the first turn finished. The claim above is saved, so an
  // overlapping tick sees the advanced `at` and does nothing.
  const outcomes = await Promise.allSettled(ready.map((row) => Promise.resolve().then(() => deliver(row))));
  const fired = [];
  outcomes.forEach((outcome, index) => {
    const row = ready[index];
    const threadId = Number(row.threadId) || 0;
    if (outcome.status === 'rejected') {
      // Not retried: the agent may have run and only the answer failed, so a
      // retry loop would repeat that work every twenty seconds.
      note(`schedule ${row.id} not delivered: ${outcome.reason?.message ?? outcome.reason}`);
      return;
    }
    fired.push(row.id);
    note(`schedule ${row.id} fired in ${row.chatId}${threadId ? ` topic=${threadId}` : ''}; next at ${new Date(Number(row.at)).toISOString()}`);
  });
  return fired;
}

/**
 * Does the topic this row points at still exist?
 *
 * `sendChatAction` is the cheapest call that names a thread and fails when the
 * thread is gone. Nothing is posted, so a probe leaves no trace in the chat.
 */
async function probeTopic(row, threadId) {
  if (!(threadId > 0)) return;
  await tg('sendChatAction', {
    chat_id: Number(row.chatId),
    action: 'typing',
    message_thread_id: threadId,
  });
}
