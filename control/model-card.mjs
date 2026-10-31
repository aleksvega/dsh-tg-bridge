// `/model` as a picker: every route the profile can run, one button each.
//
// The list this replaces was the ids alone, and the ids repeat — `deepseek-v4.1-flash`
// is declared by both wikivibe and unorouter — so a person looking for "the
// unorouter one" saw the same name twice with nothing to tell them apart, and
// `/model deepseek-v4.1-flash` silently kept whichever provider the patch
// already had. A model and the endpoint that serves it are one choice, so the
// buttons carry both.
//
// A press names the route in full (`md:unorouter:deepseek-v4.1-flash`), not an
// index into the card: an index would mean "the 4th model" and would switch to
// the wrong route the moment a profile gained or lost a model between drawing
// the card and the tap. Telegram caps callback data at 64 bytes, so a route too
// long to name gets no button — a button that cannot say what it does is worse
// than a line of text that can.
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

/** The callback data for one route, or '' when it cannot be said in 64 bytes. */
export function routeData(provider, model, { scope = 'topic' } = {}) {
  const prefix = scope === 'all' ? `${MODEL_PREFIX}@` : MODEL_PREFIX;
  const data = `${prefix}${provider}:${model}`;
  return Buffer.byteLength(data, 'utf8') <= 64 ? data : '';
}

/** What a press asks for: the provider, the model, "follow the profile", or null. */
export function modelPress(data) {
  const text = String(data || '');
  if (!text.startsWith(MODEL_PREFIX)) return null;
  const rest = text.slice(MODEL_PREFIX.length);
  if (rest === 'list') return { kind: 'list' };
  if (rest === 'auto') return { kind: 'auto' };
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

export const SCOPE_ALL = '@all';
export const SCOPE_TOPIC = '@topic';

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
 * One button per route, labelled `provider · model` so the answer to "where do
 * the answers come from" is on the button itself. The current route is marked,
 * because the first thing a person checks is whether they are already on the
 * route they want. The provider is repeated on every button even though it makes
 * them longer: it is the only way the label survives, since a heading row is a
 * button without a payload and the keyboard refuses those.
 */
export function modelCard({
  profile, routes, current = null, topic = false, fallback = null, answered = null, t, limit = 60,
  scope = 'topic',
}) {
  const now = current || (routes.find((route) => route.current) || null);
  const isNow = (route) => Boolean(now && route.provider === now.provider && route.model === now.model);
  // A route may be too long to name in 64 bytes, and the global form carries one
  // extra character, so a route can be pressable in one scope and not the other.
  const known = routes.filter((route) => routeData(route.provider, route.model, { scope }));
  const rows = [];
  let hidden = 0;
  let drawn = 0;
  for (const route of known) {
    if (drawn >= limit) {
      hidden += 1;
      continue;
    }
    const mark = isNow(route) ? '✓ ' : '';
    // The provider is on the button, not on a row above it. A heading is a
    // button with no payload, and `inlineKeyboard` drops those — it has to,
    // because Telegram refuses a button with no callback data and rejects the
    // whole message with it. Dropping the heading left two identical
    // `deepseek-v4.1-flash` buttons that switched to different endpoints, which
    // is precisely the confusion a route picker exists to remove.
    rows.push([
      {
        text: `${mark}${route.provider} · ${route.model}`,
        data: routeData(route.provider, route.model, { scope }),
      },
    ]);
    drawn += 1;
  }
  rows.push([{ text: t('ctrl.model.pickRefresh'), data: `${MODEL_PREFIX}list` }]);
  // Where a press lands, on the card itself. The scope is the one thing about
  // this card that a person cannot see from the buttons — the same route tapped
  // in the two modes changes one topic or the whole install — so it is a row of
  // its own that says which mode is on and how to change it. A card with nothing
  // to pick gets no toggle: a mode for a choice that does not exist is noise.
  if (routes.length > 0) {
    rows.push([scope === 'all'
      ? { text: t('ctrl.model.scopeAllOn'), data: `${MODEL_PREFIX}${SCOPE_TOPIC}` }
      : { text: t('ctrl.model.scopeTopicOn'), data: `${MODEL_PREFIX}${SCOPE_ALL}` }]);
  }
  // The way back to the profile, and only when there is something to go back
  // from: a button that clears a choice nobody made is a button that does
  // nothing and looks broken.
  if (topic && scope !== 'all') rows.push([{ text: t('ctrl.model.pickFollow'), data: `${MODEL_PREFIX}auto` }]);

  const lines = [t('ctrl.model.pickTitle', { profile })];
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
  // models at all, a profile whose every route is too long to be a button, and
  // one whose routes are simply cut off by the row cap below.
  if (routes.length === 0) lines.push(t('ctrl.model.pickNone', { profile }));
  else if (known.length === 0) lines.push(t('ctrl.model.pickLong', { profile }));
  else lines.push(t(scope === 'all' ? 'ctrl.model.scopeAllHint' : 'ctrl.model.pickHint'));
  if (hidden > 0) lines.push(t('ctrl.model.pickHidden', { n: hidden }));
  return {
    text: lines.join('\n'),
    keyboard: rows,
    shown: drawn,
    total: routes.length,
    current,
    scope,
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
  const draw = (scope = 'topic') => {
    const route = scope === 'all'
      ? { ...modelOf(profile), source: 'profile' }
      : topicRoute({ state: live, key });
    return modelCard({
      profile,
      routes: routesOf(profile),
      current: { provider: route.provider, model: route.model },
      topic: route.source === 'topic',
      fallback: route.source === 'topic' ? modelOf(profile) : null,
      t: (k, v) => t(lang, k, v),
      scope,
    });
  };
  if (press.kind === 'list') {
    await redraw(draw(press.scope || 'topic'));
    await answer(t(lang, 'ctrl.model.pickRefresh'));
    return true;
  }
  // Switching the mode changes nothing by itself — it only decides where the
  // NEXT tap lands. Saying so in the answer is what keeps the two-step flow from
  // reading as "the button did nothing".
  if (press.kind === 'scope') {
    const scope = press.scope === 'all' ? 'all' : 'topic';
    await redraw(draw(scope));
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
  const wanted = `${press.provider}/${press.model}`;
  if (!routes.some((route) => route.provider === press.provider && route.model === press.model)) {
    await say(t(lang, 'ctrl.model.pickStale', { name: profile, route: wanted }));
    await redraw(draw(press.scope));
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
  await redraw(draw('topic'));
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