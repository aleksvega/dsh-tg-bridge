// `/model` as a two-step picker: the endpoint first, its models second.
//
// The flat list this replaces was one tap shorter and two problems worse. A
// profile with seventeen routes does not fit on a phone, and two endpoints that
// both serve `deepseek-v4.1-flash` made two buttons with the same name — the
// person looking for "the unorouter one" had nothing to tell them apart, and
// `/model deepseek-v4.1-flash` silently kept whichever provider the patch
// already had. A model and the endpoint that serves it are one choice, so the
// choice is made in two steps and the second screen cannot repeat the first.
//
// A press names its subject in full (`md:!p:unorouter`, `md:unorouter:model`),
// never an index: an index would mean "the fourth model" and would switch to the
// wrong route the moment the profile gained or lost one between drawing the card
// and the tap. Telegram caps callback data at 64 bytes, so a name too long to
// fit gets no button — a button that cannot say what it does is worse than a
// line of text that can.
import { modelOf, routesOf, setModel } from './models.mjs';
import { clearTopicRoute, routeExists, setTopicRoute, topicRoute } from './topic-route.mjs';
import { baseProfileOf } from '../turn/turn.mjs';
import { saveState, state } from '../core/state.mjs';
// Imported for `modelPressRouter`, which hands the card's messages their `t`.
// The handler below takes `t` as a parameter and the tests pass one in, so a
// missing binding here survived a green suite while every real tap died with
// "t is not defined": the router is the only caller that has to supply it.
import { t } from '../core/i18n.mjs';
import { send, tg, tgFast } from '../chat/telegram.mjs';

export const MODEL_PREFIX = 'md:';
/** Step one: the endpoint list. `md:!p` on its own asks for it again. */
export const PROVIDER_STEP = `${MODEL_PREFIX}!p`;
export const SCOPE_ALL = '@all';
export const SCOPE_TOPIC = '@topic';

/** The callback data that opens one endpoint's models. */
export function providerData(provider) {
  const data = `${PROVIDER_STEP}:${provider}`;
  return Buffer.byteLength(data, 'utf8') <= 64 ? data : '';
}

/**
 * The scope row, carrying the step it was pressed on.
 *
 * Without the endpoint the toggle would send a person who is choosing a model
 * back to the endpoint list — a mode switch that loses the choice it was about
 * to make. `@` cannot appear in a provider id (`[\w.-]` only), so the older
 * `md:@all` form and this one can coexist while cards in flight still work.
 */
export function scopeData(scope, provider = '') {
  return `${MODEL_PREFIX}!s:${scope === 'all' ? 'all' : 'topic'}${provider ? `:${provider}` : ''}`;
}

/** Refresh keeps the step, so a refresh is not a step backwards. */
function listData(provider = '') {
  return provider ? `${MODEL_PREFIX}list:${provider}` : `${MODEL_PREFIX}list`;
}

/** The callback data for one route, or '' when it cannot be said in 64 bytes. */
export function routeData(provider, model, { scope = 'topic' } = {}) {
  const prefix = scope === 'all' ? `${MODEL_PREFIX}@` : MODEL_PREFIX;
  const data = `${prefix}${provider}:${model}`;
  return Buffer.byteLength(data, 'utf8') <= 64 ? data : '';
}

/**
 * What a press asks for: an endpoint's models, a specific route, the scope,
 * "follow the profile", a refresh — or null when the data is not this card's.
 */
export function modelPress(data) {
  const text = String(data || '');
  if (!text.startsWith(MODEL_PREFIX)) return null;
  const rest = text.slice(MODEL_PREFIX.length);
  if (rest === 'list') return { kind: 'list' };
  // A provider may legitimately be called `list`; that one endpoint is then
  // reachable by name only through the typed command. The alternative — reading
  // `md:list:alpha` as a route — would make the refresh button of step two
  // switch a model, which is worse than one unreachable spelling.
  if (rest.startsWith('list:')) {
    const provider = rest.slice('list:'.length);
    return /^[\w.-]+$/.test(provider) ? { kind: 'list', provider } : null;
  }
  if (rest === 'auto') return { kind: 'auto' };
  // `!` opens the two-step navigation: `!p` is "show the endpoints again",
  // `!p:<provider>` is "that endpoint's models", `!s:<scope>[:<provider>]` is the
  // scope toggle. None of these can be mistaken for a route, because a provider
  // id cannot contain `!` and the route form is checked after them.
  if (rest === '!p') return { kind: 'providers' };
  if (rest.startsWith('!p:')) {
    const provider = rest.slice('!p:'.length);
    return /^[\w.-]+$/.test(provider) ? { kind: 'provider', provider } : null;
  }
  if (rest.startsWith('!s:')) {
    const [scope, provider] = rest.slice('!s:'.length).split(':');
    return {
      kind: 'scope',
      scope: scope === 'all' ? 'all' : 'topic',
      ...(provider && /^[\w.-]+$/.test(provider) ? { provider } : {}),
    };
  }
  // The global switch, reachable from the card: without it the only way to move
  // every topic at once is the typed `/model <route> global`, which is exactly
  // the spelling a person opens the panel to avoid. The scope is carried in the
  // press data, so the two taps ("everywhere", then a route) keep the intent
  // between them without the card having to remember anything.
  //
  // `@` marks the scope because it cannot appear in a provider id (`[\w.-]`
  // only), so `md:@alpha:beta` is never mistaken for a route on a provider
  // named `@alpha` — and a provider may legitimately be called `all`.
  if (rest === SCOPE_ALL) return { kind: 'scope', scope: 'all' };
  if (rest === SCOPE_TOPIC) return { kind: 'scope', scope: 'topic' };
  if (rest.startsWith('@')) {
    const route = splitRoute(rest.slice(1));
    return route ? { kind: 'route', scope: 'all', ...route } : null;
  }
  const route = splitRoute(rest);
  return route ? { kind: 'route', scope: 'topic', ...route } : null;
}

/** `provider:model` -> both halves, or null when either is empty or malformed. */
function splitRoute(text) {
  const cut = text.indexOf(':');
  if (cut <= 0 || cut === text.length - 1) return null;
  const provider = text.slice(0, cut);
  const model = text.slice(cut + 1);
  if (!/^[\w.-]+$/.test(provider) || !/^[\w.:-]+$/.test(model)) return null;
  return { provider, model };
}

/**
 * The card and its keyboard.
 *
 * Step one lists the endpoints with how many routes each carries; step two lists
 * one endpoint's models. `provider` decides the step: empty is the endpoint
 * list, a name is that endpoint's models. An endpoint the profile no longer has
 * falls back to step one rather than drawing an empty screen.
 *
 * The endpoint is on the header of step two, not on every model button: this
 * screen only ever shows one endpoint, so a model name is unambiguous here,
 * while the step-one list is exactly where the endpoints are named.
 */
export function modelCard({
  profile, routes, current = null, topic = false, fallback = null, answered = null, t, limit = 60,
  scope = 'topic', provider = '',
}) {
  const now = current || (routes.find((route) => route.current) || null);
  const isNow = (route) => Boolean(now && route.provider === now.provider && route.model === now.model);
  const groups = new Map();
  for (const route of routes) {
    if (!groups.has(route.provider)) groups.set(route.provider, []);
    groups.get(route.provider).push(route);
  }
  const step = provider && groups.has(provider) ? 'models' : 'providers';
  const rows = [];
  let hidden = 0;
  let drawn = 0;
  if (step === 'providers') {
    for (const [name, list] of groups) {
      const data = providerData(name);
      // A route may be too long to name in 64 bytes, and the global form carries
      // one extra character, so the endpoint button is checked in both scopes.
      if (!data || drawn >= limit) {
        hidden += 1;
        continue;
      }
      const mark = now && now.provider === name ? '✓ ' : '';
      // The count is the one useful fact about an endpoint before its models are
      // shown: it says whether the next screen is two buttons or twenty.
      rows.push([{
        text: `${mark}${t('ctrl.model.pickProviderRow', { provider: name, n: list.length })}`,
        data,
      }]);
      drawn += 1;
    }
  } else {
    for (const route of groups.get(provider)) {
      const data = routeData(route.provider, route.model, { scope });
      if (!data || drawn >= limit) {
        hidden += 1;
        continue;
      }
      const mark = isNow(route) ? '✓ ' : '';
      rows.push([{ text: `${mark}${route.model}`, data }]);
      drawn += 1;
    }
    rows.push([{ text: t('ctrl.model.pickBack'), data: PROVIDER_STEP }]);
  }
  rows.push([{ text: t('ctrl.model.pickRefresh'), data: listData(step === 'models' ? provider : '') }]);
  // Where a press lands, on the card itself. The scope is the one thing about
  // this card that a person cannot see from the buttons — the same model tapped
  // in the two modes changes one topic or the whole install — so it is a row of
  // its own that says which mode is on and how to change it. A card with nothing
  // to pick gets no toggle: a mode for a choice that does not exist is noise.
  if (routes.length > 0) {
    rows.push([scope === 'all'
      ? { text: t('ctrl.model.scopeAllOn'), data: scopeData('topic', step === 'models' ? provider : '') }
      : { text: t('ctrl.model.scopeTopicOn'), data: scopeData('all', step === 'models' ? provider : '') }]);
  }
  // The way back to the profile, and only when there is something to go back
  // from: a button that clears a choice nobody made is a button that does
  // nothing and looks broken. Step one only — step two already has "back".
  if (topic && scope !== 'all' && step === 'providers') {
    rows.push([{ text: t('ctrl.model.pickFollow'), data: `${MODEL_PREFIX}auto` }]);
  }

  const lines = [t('ctrl.model.pickTitle', { profile })];
  if (step === 'models') lines.push(t('ctrl.model.pickModelsTitle', { provider }));
  // In the global mode the header must not describe this topic: a card that says
  // "this topic runs X" while every tap moves the whole install is worse than no
  // header at all, because the person checks exactly that line before tapping.
  if (scope === 'all') {
    lines.push(t('ctrl.model.scopeAllHead', { route: `${now?.provider || '?'}/${now?.model || '?'}` }));
  } else if (now) {
    lines.push(t(topic ? 'ctrl.model.pickNowTopic' : 'ctrl.model.pickNow', { route: `${now.provider}/${now.model}` }));
    if (topic && fallback) {
      lines.push(t('ctrl.model.pickNowDefault', { route: `${fallback.provider}/${fallback.model}` }));
    }
  } else lines.push(t('ctrl.model.pickUnknown', { profile }));
  // The route above is the one this topic is set to. After a fallback the turn
  // ran somewhere else, and a card that only names the setting reads as "this is
  // who answers" when it is not.
  if (answered?.model && scope !== 'all') {
    lines.push(t(answered.switched ? 'ctrl.model.answeredSwitched' : 'ctrl.model.answered', { model: answered.model }));
  }
  lines.push('');
  // Three different silences, and they are not the same fact: a profile with no
  // models at all, one endpoint whose every model is too long to be a button,
  // and a list simply cut off by the row cap below.
  if (routes.length === 0) lines.push(t('ctrl.model.pickNone', { profile }));
  else if (step === 'providers') lines.push(t('ctrl.model.pickProvidersHint'));
  else if (drawn === 0) lines.push(t('ctrl.model.pickLong', { profile }));
  else lines.push(t(scope === 'all' ? 'ctrl.model.scopeAllHint' : 'ctrl.model.pickHint'));
  if (hidden > 0) lines.push(t('ctrl.model.pickHidden', { n: hidden }));
  return {
    text: lines.join('\n'),
    keyboard: rows,
    shown: drawn,
    total: step === 'providers' ? groups.size : groups.get(provider).length,
    current,
    scope,
    step,
    provider: step === 'models' ? provider : '',
  };
}

/**
 * Act on a press, and redraw the card in place.
 *
 * The route is checked against the profile as it is now, not against what the
 * card was drawn from: a profile can gain or lose a model between the two, and
 * writing a route that is no longer declared would leave a patch that looks
 * switched and a bot that cannot answer. A press for a route that is gone says
 * so and redraws what is actually available, so the next tap is informed.
 */
export async function handleModelPress({
  data, profile, key = '', state: live = state, save = saveState, lang, t, say, answer, redraw,
}) {
  const press = modelPress(data);
  if (!press) return false;
  const routes = routesOf(profile);
  // The card is drawn in whichever scope the press carried, so the tick, the
  // header and the button data always describe the same promise: in `topic` the
  // one this chat answers on, in `all` the default every other topic follows.
  const draw = (scope = 'topic', provider = '') => {
    const route = scope === 'all'
      ? { ...modelOf(profile), source: 'profile' }
      : topicRoute({ state: live, key });
    return modelCard({
      profile,
      routes,
      current: { provider: route.provider, model: route.model },
      topic: route.source === 'topic',
      fallback: route.source === 'topic' ? modelOf(profile) : null,
      t: (k, v) => t(lang, k, v),
      scope,
      provider,
    });
  };
  if (press.kind === 'list') {
    await redraw(draw(press.scope || 'topic', press.provider || ''));
    await answer(t(lang, 'ctrl.model.pickRefresh'));
    return true;
  }
  // Switching the mode changes nothing by itself — it only decides where the
  // NEXT tap lands. Saying so in the answer is what keeps the two-step flow from
  // reading as "the button did nothing".
  if (press.kind === 'scope') {
    const scope = press.scope === 'all' ? 'all' : 'topic';
    await redraw(draw(scope, press.provider || ''));
    await answer(t(lang, scope === 'all' ? 'ctrl.model.scopeAllSet' : 'ctrl.model.scopeTopicSet'));
    return true;
  }
  if (press.kind === 'auto') {
    clearTopicRoute(live, key);
    save();
    const route = topicRoute({ state: live, key });
    await say(t(lang, 'ctrl.model.topicCleared', { route: `${route.provider}/${route.model}` }));
    await redraw(draw('topic'));
    return true;
  }
  if (press.kind === 'providers') {
    await redraw(draw('topic', ''));
    await answer(t(lang, 'ctrl.model.pickStepOne'));
    return true;
  }
  if (press.kind === 'provider') {
    // The endpoint may have left the profile since the card was drawn. Saying so
    // and showing the list as it is now is the same rule the route press
    // follows: never draw a screen built from a stale card.
    if (!routes.some((route) => route.provider === press.provider)) {
      await say(t(lang, 'ctrl.model.pickProviderGone', { provider: press.provider }));
      await redraw(draw('topic', ''));
      return true;
    }
    await redraw(draw(press.scope || 'topic', press.provider));
    await answer(t(lang, 'ctrl.model.pickStepTwo', { provider: press.provider }));
    return true;
  }
  const wanted = `${press.provider}/${press.model}`;
  if (!routes.some((route) => route.provider === press.provider && route.model === press.model)) {
    await say(t(lang, 'ctrl.model.pickStale', { name: profile, route: wanted }));
    await redraw(draw(press.scope, press.provider));
    return true;
  }
  // The global scope writes the profile's own default — the same edit the typed
  // `/model <route> global` makes, so the panel and the command cannot drift.
  if (press.scope === 'all') {
    if (!setModel(profile, wanted)) {
      await say(t(lang, 'ctrl.model.failed', { name: profile, model: wanted }));
      await redraw(draw('all'));
      return true;
    }
    const kept = Object.keys(live.route || {}).length;
    // Named `line`, not `answer`: `answer` is the callback-acknowledgement
    // parameter of this function, and shadowing it would silently disable the
    // tap feedback for this branch alone.
    const line = t(lang, 'ctrl.model.switched', { name: profile, model: wanted, desktop: '' });
    await say(kept > 0 ? `${line}\n${t(lang, 'ctrl.model.topicKept', { n: kept })}` : line);
    await answer(t(lang, 'ctrl.model.scopeAllSet'));
    await redraw(draw('all'));
    return true;
  }
  setTopicRoute(live, key, press);
  save();
  // The answer names both scopes: the switch is this topic's, and saying only
  // "route → x" would read as a change to the whole install.
  const now = topicRoute({ state: live, key });
  const head = modelOf(profile);
  await say(t(lang, 'ctrl.model.topicSet', {
    route: `${now.provider}/${now.model}`,
    default: `${head.provider}/${head.model}`,
  }));
  // Back to the endpoint list, with the tick moved: the choice is finished, and
  // leaving the person on the model screen of the endpoint they just left reads
  // as "it did not take".
  await redraw(draw('topic', ''));
  return true;
}

/**
 * Bind the press handler to one card in one chat.
 *
 * The wiring lives here rather than in `callbacks.mjs` because that file is the
 * router and this is a card: the redraw edits the same message the buttons came
 * from, which is what makes a tap feel like a switch instead of a new answer.
 */
export function modelPressRouter({ chatId, threadId, messageId, key, lang, answer, log }) {
  return (data) =>
    handleModelPress({
      data,
      profile: baseProfileOf(key),
      key,
      lang,
      t,
      say: async (text) => send(chatId, text, threadId),
      answer,
      redraw: (card) =>
        tgFast('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: card.text,
          reply_markup: { inline_keyboard: card.keyboard },
          ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        }).catch(() => {}),
    }).then((claimed) => {
      if (claimed) log(`model press ${data} for ${key}`);
      return claimed;
    });
}