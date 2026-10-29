// The model chain: what the bridge does when the first route refuses.
//
// Extracted from `handle-message.mjs`, which sits at the 500-line ceiling, and
// because a chain that mixes companies is a decision of its own: which model,
// on whose route, and when to stop asking.
//
// One behaviour changed while moving it. A provider whose channel pool is down
// (`get_channel_failed`, "all providers are busy") used to end the whole chain
// after a single probe, because every model sat on one router and the probe
// answered for all of them. With models from different companies that break is
// wrong: a 503 from one route says nothing about another company's, so each
// entry is probed on its own provider and a dead pool skips only its models.
import { existsSync } from 'node:fs';
import { t } from './i18n.mjs';
import { describeVerdicts, firstLiveModel, probeHint, probeModel } from './model-probe.mjs';
import { ensureProfile } from './profiles.mjs';
import { config, log } from './state.mjs';
import { killTurn, runTurnLive } from './turn.mjs';

/** Errors that mean "this route cannot answer now", not "the task is wrong". */
export const FALLBACK_TRIGGERS = /RATE_LIMIT|503|get_channel_failed|all providers|нет активности|EMPTY_RESPONSE|TIMEOUT|overloaded|AUTH|403|insufficient_user_quota|quota|UNKNOWN_MODEL|MISSING_CREDENTIAL/i;
/** A dead balance is not a busy provider: it must reach the free tail as well. */
export const QUOTA_LIKE = /insufficient_user_quota|AUTH\b|\b403\b|\b401\b|quota|balance|баланс|payment|billing/i;
/** The provider's own channel pool, not the model: it is down for every model. */
export const CHANNEL_DOWN = /get_channel_failed|all providers|no providers|503/i;

/** `provider/model` — the way the chat names a route. */
export function labelOf(entry = {}) {
  const model = String(entry.model || '');
  return entry.provider ? `${entry.provider}/${model}` : model;
}

/**
 * Whether the chain's failure deserves one message that names the causes.
 *
 * Three ways to get here: every entry was tried, a probe found nothing alive, or
 * entries were skipped because their own route was dead. A short chain with no
 * verdict is the one case that must stay quiet — it is not proof of anything.
 */
export function exhausted({ tried = [], chainLength = 0, probeKind = '' } = {}) {
  if (tried.length === 0) return false;
  return Boolean(probeKind) || tried.length >= chainLength;
}

/**
 * Walk the chain after a failed turn and return the turn's final result.
 *
 * @param {object} ctx
 * @param {object} ctx.result        the failed turn: `{error}` decides whether to go on
 * @param {Array}  ctx.chain         `config.fallbackModels`: `{model, provider?, patch, free?}`
 * @param {object} ctx.primary       `{provider, model}` this topic actually runs on
 * @param {string} ctx.turnProfile   the profile the first attempt used
 * @param {string} ctx.topicProfile  the topic's own profile, used if a patch is unusable
 * @returns {Promise<object>} the same shape `runTurnLive` returns
 */
export async function runFallbackChain({
  result, chain = [], primary = {}, text, sessionAtStart, key = '', where = '', chatId, threadId,
  lang = 'ru', cwd = '', turnProfile = '', topicProfile = '', telemetry = {}, onEvent = null,
  thoughtEnv = {}, send,
}) {
  const run = (profile) => runTurnLive(text, sessionAtStart, key, {
    onEvent,
    onAbort: () => killTurn(key),
    env: thoughtEnv,
    // Same overlay problem as the vision turn: the host CLI has no --patch. A
    // patch file that is missing or unreadable must not turn into an empty
    // `--profile` argument, so the topic's own profile is the fallback.
    profile: profile || topicProfile || config.profile,
    cwd,
    lang,
  });
  const tried = [];

  for (const entry of chain) {
    if (!result.error || !FALLBACK_TRIGGERS.test(result.error)) break;
    if (!entry.patch || !existsSync(entry.patch)) continue;
    // A dead channel pool skips only the models behind it: another company's
    // route is a separate question, and the old probe asked the first provider
    // about all of them. A balance error is not probed — it already names the
    // model that refused, and a probe would spend a request to learn that.
    if (CHANNEL_DOWN.test(result.error)) {
      const verdict = await probeModel(entry.model, { provider: entry.provider });
      if (!verdict.ok) {
        log(`channel down for ${labelOf(entry)}: probe says ${verdict.kind}; skipping it`);
        tried.push(`${labelOf(entry)}: ${verdict.kind}`);
        continue;
      }
      log(`channel down, but ${labelOf(entry)} answers the probe; trying it`);
    }
    // Quota failures never deserve a retry of the same model: the balance is
    // gone, so waiting is pure loss. Anything else is transient.
    const quotaLike = QUOTA_LIKE.test(result.error);
    const reason = quotaLike ? t(lang, 'bridge.fallback.quota') : t(lang, 'bridge.fallback.noAnswer');
    tried.push(`${labelOf(entry)}: ${String(result.error).slice(0, 120)}`);
    log(`fallback to ${labelOf(entry)} for ${where} reason=${quotaLike ? 'quota' : 'transient'} after: ${String(result.error).slice(0, 120)}`);
    telemetry.model = labelOf(entry);
    // The person sees every switch, not only the final give-up: a chain of five
    // companies that silently ends on the fifth reads like a hang.
    await send(chatId, t(lang, 'bridge.fallback.switched', {
      reason,
      model: labelOf(entry),
      free: entry.free ? ' (free)' : '',
    }), threadId);
    result = await run(ensureProfile(entry.patch));
    if (!result.error) break;
  }

  // Every model refused. Before saying "all models are unavailable", ask each
  // route directly with a 1-token request: a 503 storm usually clears within
  // seconds, and the verdict tells the person whether a balance is gone or a
  // provider is merely busy.
  let probeKind = '';
  if (result.error && FALLBACK_TRIGGERS.test(result.error)) {
    const models = [
      { model: primary.model, provider: primary.provider || '' },
      ...chain.map((entry) => ({ model: entry.model, provider: entry.provider || '' })),
    ].filter((item) => item.model && item.model !== '?');
    const { live, verdicts } = await firstLiveModel(models);
    if (live) {
      log(`probe: ${labelOf(live)} answers after ${verdicts.length} check(s), retrying the turn there`);
      const entry = chain.find((item) => item.model === live.model
        && (!live.provider || item.provider === live.provider));
      result = await run(entry ? ensureProfile(entry.patch) : turnProfile);
    } else {
      // Nothing answers: the verdict is the only useful part of the failure.
      probeKind = describeVerdicts(verdicts);
      log(`probe: no channel answers (${verdicts.map((v) => `${labelOf(v)}:${v.kind}`).join(', ')})`);
    }
  }
  // One message naming the causes, not a cascade of errors.
  if (result.error && exhausted({ tried, chainLength: chain.length, probeKind })) {
    log(`all fallbacks exhausted for ${where}: ${tried.length} probe=${probeKind || 'n/a'}`);
    const verdictLine = probeKind ? `\n${probeHint(probeKind, lang)}` : '';
    result = {
      sessionId: result.sessionId,
      text: '',
      error: t(lang, 'bridge.fallback.allDown', { list: tried.map((line) => `• ${line}`).join('\n') }) + verdictLine,
    };
  }
  return result;
}
