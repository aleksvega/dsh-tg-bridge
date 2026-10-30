// The clocks the bridge owns: goal jobs, agent-set jobs, reminders.
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
import { send } from '../chat/telegram.mjs';

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
}
