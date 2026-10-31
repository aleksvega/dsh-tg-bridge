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
import { t } from '../core/i18n.mjs';
import { describeVerdicts, firstLiveModel, probeHint, probeModel } from './model-probe.mjs';
import { ensureProfile } from '../profile/profiles.mjs';
import { config, log } from '../core/state.mjs';
import { killTurn, runTurnLive } from '../turn/turn.mjs';

/**
 * The ways a route fails, one family per line.
 *
 * The chain used to know four of them (5xx, quota words, AUTH, empty answer) and
 * every other way a provider says no ended the walk on its first iteration. The
 * incident that exposed it: `wikivibe API error (400): WikiVibe could not accept
 * these request parameters` — a refusal from one company, six other routes
 * unused, and not one `fallback` line in the log to say why. A family is a
 * statement about the ROUTE; a family that is really about the task belongs in
 * the negative list below, not here.
 */
/**
 * The route refuses the request itself: its own validator, not the task.
 *
 * Only the 400 class is here. A 429 or a 5xx is also "the route cannot answer",
 * but neither is a verdict on the request: they are rate and load, they must not
 * spend the refusal budget, and the chat explains them differently. Listing
 * `[45]\d\d` wholesale was how a rate limit got reported as a bad request.
 */
export const ROUTE_REJECTS = /INVALID_REQUEST|invalid_request_error|API error \((?:400|413|422)\)|HTTP (?:400|413|422)|Bad Request|unprocessable/i;
/** The request never reached a model: DNS, TLS, a reset socket, a dead tunnel. */
export const TRANSPORT_DOWN = /ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network error|UND_ERR|other side closed|TLS|handshake/i;
/** The provider is up but cannot serve now: overload, gateway, internal error. */
export const SERVER_DOWN = /\b50[0234]\b|overloaded|service unavailable|bad gateway|gateway time-?out|internal server error|get_channel_failed|all providers|no providers/i;
/** Too many requests in a window: waiting helps, another vendor helps sooner. */
export const RATE_LIMITED = /RATE_LIMIT|\b429\b|rate.?limit|too many requests/i;
/** The key or the balance, not the model: only a top-up or another account helps. */
export const AUTH_FAILED = /\b40[123]\b|AUTH\b|unauthorized|forbidden|MISSING_CREDENTIAL|no credentials|not authenticated/i;
/** The route does not carry that model id at all. */
export const MODEL_GONE = /UNKNOWN_MODEL|model[_ ]not[_ ]found|no such model|model not supported/i;
/**
 * The conversation does not fit the route's window.
 *
 * This is the one "request-shaped" failure that is still per-route, which is why
 * it triggers the chain where a bad tool schema does not. A window belongs to the
 * model: 131k here, a million tokens two routes down, so the same prompt that a
 * narrow route cannot hold is answered by a wide one. The provider rejects it
 * before generating anything, so walking costs a round trip, not a full turn.
 *
 * It used to match no family at all, so the walk stopped on the first entry,
 * every remaining route went untried, and the turn ended on the raw CLI string
 * with no message explaining it — which is exactly what "the chain did nothing
 * and everything froze" looked like from the chat.
 */
export const CONTEXT_OVERFLOW = /CONTEXT_WINDOW_EXCEEDED|context[_ ]length|maximum context|context window|reduce the length|prompt is too long|exceeds the context/i;
/** The model answered with nothing: silence is a failure, not an empty success. */
export const EMPTY_ANSWER = /EMPTY_RESPONSE|empty response|no output|пустой ответ|нет активности|returned nothing/i;

/**
 * How many routes may refuse the request before the walk stops.
 *
 * A refusal (`400 INVALID_REQUEST`, a vendor's own validator) is replayed in
 * full: the same long conversation, the same tools, the same tokens. One other
 * route answers the only useful question — "is it this vendor or this prompt" —
 * and if it refuses identically, the sixth will too, only slower. Busy, quota
 * and transport failures have no such budget: those are per-route facts and the
 * whole chain is worth walking.
 */
export const REFUSAL_BUDGET = 1;

/**
 * Failures that must NOT start the chain, and why.
 *
 * These are not provider answers at all — the turn never reached a model, or it
 * ended by our own decision — so no other vendor can change the outcome and a
 * replay would cost a full turn to learn that. Everything a PROVIDER says,
 * including a 400 and a refused tool shape, does start the chain: a strict
 * vendor rejecting a request another one accepts is exactly the case a chain
 * exists for.
 */
export const NOT_A_ROUTE_FAULT = /turn exceeded|hard cap|turn hard cap|terminated by user|stopped by user|already owned by an active write handle|unknown id|was recorded in|spawn .*ENOENT|dsh (cli|app) not found/i;
/**
 * A dead balance is not a busy provider: it must reach the free tail as well.
 *
 * A bare 401/403 is NOT here: without a balance word it is a refused key, and
 * calling that a quota problem sends the person to top up an account whose key
 * was simply wrong. The words below are the only ones that mean money.
 *
 * "allowance" and "wallet" earn their place from a live incident: a router that
 * had spent its period answered `403 Your subscription allowance for this period
 * is used up and your wallet…`, the 403 claimed it as `auth`, and the chat told
 * the owner their key was refused while the real fix was to top up or move on —
 * the opposite of the useful advice, for the exact failure they were debugging.
 */
export const QUOTA_LIKE = /insufficient_user_quota|insufficient quota|\b402\b|quota|balance|баланс|payment|billing|allowance|wallet|credit/i;
/** The provider's own channel pool, not the model: it is down for every model. */
export const CHANNEL_DOWN = /get_channel_failed|all providers|no providers|\b50[234]\b/i;

/**
 * Errors that mean "this route cannot answer now", not "the task is wrong".
 *
 * Every family belongs here, including the balance one: a route with an empty
 * account is exactly a route the chain must walk past, and leaving quota out was
 * how `insufficient_user_quota` used to end the turn on the first entry.
 */
export const FALLBACK_TRIGGERS = new RegExp([
  ROUTE_REJECTS, TRANSPORT_DOWN, SERVER_DOWN, RATE_LIMITED, AUTH_FAILED, MODEL_GONE, EMPTY_ANSWER, QUOTA_LIKE,
  CONTEXT_OVERFLOW,
].map((family) => family.source).join('|'), 'i');

/**
 * Which family a failure belongs to, or '' when it is not a route's fault.
 *
 * The order matters: a message can name several things ("AUTH 403
 * insufficient_user_quota"), and the first family that claims it decides how the
 * chat explains the switch and whether a probe is worth spending. The longest
 * window is claimed first for that reason: "API error (400): maximum context
 * length exceeded" is a prompt-too-long, and calling it a refusal sent the
 * person to rewrite a request that was never the problem.
 */
const FAMILY_RULES = [
  ['context', CONTEXT_OVERFLOW],
  ['refused', ROUTE_REJECTS],
  ['quota', QUOTA_LIKE],
  ['auth', AUTH_FAILED],
  ['busy', SERVER_DOWN],
  ['rate', RATE_LIMITED],
  ['transport', TRANSPORT_DOWN],
  ['model', MODEL_GONE],
  ['empty', EMPTY_ANSWER],
];

/** The sentence a switch shows: one per family, because "the model did not answer" is not true for a 401. */
export const FAMILY_REASON = {
  context: 'bridge.fallback.context',
  refused: 'bridge.fallback.rejected',
  quota: 'bridge.fallback.quota',
  auth: 'bridge.fallback.auth',
  busy: 'bridge.fallback.busy',
  rate: 'bridge.fallback.busy',
  transport: 'bridge.fallback.network',
  model: 'bridge.fallback.model',
  empty: 'bridge.fallback.noAnswer',
};

export function failureFamily(error) {
  const text = String(error || '');
  if (!text) return '';
  if (NOT_A_ROUTE_FAULT.test(text)) return '';
  for (const [id, rule] of FAMILY_RULES) if (rule.test(text)) return id;
  return '';
}

/** `provider/model` — the way the chat names a route. */
export function labelOf(entry = {}) {
  const model = String(entry.model || '');
  return entry.provider ? `${entry.provider}/${model}` : model;
}

/**
 * The entries a turn will actually try: switched on, and with an overlay file
 * that exists.
 *
 * One list, used by the walk and by the `/fallback` card, so "the chain says it
 * has seven routes" and "the chain tries seven routes" cannot disagree. A
 * switched-off route is not a broken one: it stays in `config.json` with its
 * patch, and `/fallback on` brings it back.
 */
export function liveChain(chain = []) {
  return (Array.isArray(chain) ? chain : []).filter((entry) => entry && !entry.off && entry.patch && existsSync(entry.patch));
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
  // `/fallback off` is a promise the turn must keep: the switch is checked here,
  // before anything is sent, so a person who turned the chain off never sees a
  // "running on another model" line.
  const entries = config.fallbackEnabled === false ? [] : liveChain(chain);
  if (config.fallbackEnabled === false && result.error) {
    log(`fallback off by config for ${where}; the turn's error stands`);
  }
  // A refusal is a fact about the request, and the request is replayed in full on
  // every attempt. One other route answers "is it this vendor or this prompt";
  // the whole chain would answer it in seven hours of the same conversation.
  let refusals = 0;

  for (const entry of entries) {
    if (!result.error) break;
    // Silence here is what made the chain look dead: an error outside the list
    // ended the walk with no trace in the log, so nobody could tell "no route
    // was left" from "no route was ever tried".
    const family = failureFamily(result.error);
    if (!family) {
      log(`fallback skipped for ${where}: not a route fault — ${String(result.error).slice(0, 200)}`);
      break;
    }
    if (family === 'refused' && refusals >= REFUSAL_BUDGET) {
      log(`fallback stops after ${refusals} refusal(s) for ${where}: the request, not the route, is what is refused`);
      break;
    }
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
    // One sentence per family: "the model did not answer" is a lie for a 401, a
    // reset socket, or a vendor refusing the prompt.
    const reason = t(lang, FAMILY_REASON[family] || 'bridge.fallback.noAnswer');
    tried.push(`${labelOf(entry)}: ${String(result.error).slice(0, 120)}`);
    log(`fallback to ${labelOf(entry)} for ${where} family=${family} after: ${String(result.error).slice(0, 120)}`);
    if (family === 'refused') refusals += 1;
    // The person sees every switch, not only the final give-up: a chain of five
    // companies that silently ends on the fifth reads like a hang.
    await send(chatId, t(lang, 'bridge.fallback.switched', {
      reason,
      model: labelOf(entry),
      free: entry.free ? ' (free)' : '',
    }), threadId);
    result = await run(ensureProfile(entry.patch));
    // Named only once it answers. Recording the attempt instead would make
    // `/model` and the settings card claim a route that produced nothing.
    if (!result.error) {
      telemetry.model = labelOf(entry);
      telemetry.switched = true;
      break;
    }
  }

  // Every model refused. Before saying "all models are unavailable", ask each
  // route directly with a 1-token request: a 503 storm usually clears within
  // seconds, and the verdict tells the person whether a balance is gone or a
  // provider is merely busy.
  //
  // A route that *rejected the request* is the exception: a 1-token probe proves
  // the key works, not that this conversation is acceptable, so re-running the
  // whole turn on that route would replay a long prompt into the same 400. The
  // probe still runs — its verdict is worth reporting — but it no longer decides
  // to retry.
  let probeKind = '';
  const finalFamilyEarly = failureFamily(result.error);
  // A probe asks each route a 1-token question. That proves the key works, and
  // nothing else: a conversation the providers refuse, or one longer than their
  // window, answers a 1-token probe happily and then fails the real prompt all
  // over again. Both are facts about the request, so the probe still runs for its
  // verdict but must not decide to replay the turn.
  const replaySafe = finalFamilyEarly !== 'refused' && finalFamilyEarly !== 'context';
  const rejected = Boolean(result.error) && finalFamilyEarly === 'refused';
  if (result.error && FALLBACK_TRIGGERS.test(result.error)) {
    const models = [
      { model: primary.model, provider: primary.provider || '' },
      ...entries.map((entry) => ({ model: entry.model, provider: entry.provider || '' })),
    ].filter((item) => item.model && item.model !== '?');
    const { live, verdicts } = await firstLiveModel(models);
    if (live && replaySafe) {
      log(`probe: ${labelOf(live)} answers after ${verdicts.length} check(s), retrying the turn there`);
      const entry = entries.find((item) => item.model === live.model
        && (!live.provider || item.provider === live.provider));
      result = await run(entry ? ensureProfile(entry.patch) : turnProfile);
      // A retry after the probe counts as a switch too: the route that answered
      // is not the one the topic names, which is the whole point of the line.
      if (!result.error) {
        telemetry.model = labelOf(live);
        telemetry.switched = true;
      }
    } else {
      // Nothing answers, or the request itself is what no route can take — a
      // refusal or a prompt past every window. Only the verdict is useful then.
      probeKind = describeVerdicts(verdicts);
      const why = replaySafe ? 'no channel answers' : `the request itself is the problem (family=${finalFamilyEarly})`;
      log(`probe: ${live ? `a route answers a 1-token probe, but ${why}` : 'no channel answers'} (${verdicts.map((v) => `${labelOf(v)}:${v.kind}`).join(', ')})`);
    }
  }
  // One message naming the causes, not a cascade of errors. The chain length is
  // the number of routes a turn could actually try: an entry switched off with
  // `/fallback off` is not a route that failed to answer.
  if (result.error && exhausted({ tried, chainLength: entries.length, probeKind })) {
    log(`all fallbacks exhausted for ${where}: ${tried.length} probe=${probeKind || 'n/a'}${rejected ? ' rejected=1' : ''}`);
    const verdictLine = probeKind ? `\n${probeHint(probeKind, lang)}` : '';
    const list = tried.map((line) => `• ${line}`).join('\n');
    // A refusal is not a balance and not a busy provider: the useful advice is
    // about the conversation, not about waiting. The same is true of a prompt
    // that outgrew every window — "top up the balance" would send the person to
    // pay for a limit that money does not raise.
    const finalFamily = failureFamily(result.error);
    // The last error decides the advice. `rejected` is only a fallback for the
    // case where the retry failed with something unclassifiable.
    const refusedAll = finalFamily === 'refused' || (!finalFamily && rejected);
    const allKey = finalFamily === 'context' ? 'bridge.fallback.contextAll'
      : refusedAll ? 'bridge.fallback.rejectedAll' : 'bridge.fallback.allDown';
    result = {
      sessionId: result.sessionId,
      text: '',
      error: t(lang, allKey, { list }) + verdictLine,
    };
  }
  return result;
}
