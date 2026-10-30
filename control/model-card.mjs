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
import { modelOf, routesOf } from './models.mjs';
import { clearTopicRoute, routeExists, setTopicRoute, topicRoute } from './topic-route.mjs';
import { baseProfileOf } from '../turn.mjs';
import { saveState, state } from '../state.mjs';
import { send, tg } from '../telegram.mjs';

export const MODEL_PREFIX = 'md:';

/**
 * Group routes by provider, keeping the profile's own order: the providers a
 * person has already configured come first, and the free fallbacks last, which
 * is the order the patch declares them in.
 */
export function routeGroups(routes) {
  const out = [];
  for (const route of routes) {
    const last = out[out.length - 1];
    if (last && last.provider === route.provider) last.routes.push(route);
    else out.push({ provider: route.provider, routes: [route] });
  }
  return out;
}

/** The callback data for one route, or '' when it cannot be said in 64 bytes. */
export function routeData(provider, model) {
  const data = `${MODEL_PREFIX}${provider}:${model}`;
  return Buffer.byteLength(data, 'utf8') <= 64 ? data : '';
}

/** What a press asks for: the provider, the model, "follow the profile", or null. */
export function modelPress(data) {
  const text = String(data || '');
  if (!text.startsWith(MODEL_PREFIX)) return null;
  const rest = text.slice(MODEL_PREFIX.length);
  if (rest === 'list') return { kind: 'list' };
  if (rest === 'auto') return { kind: 'auto' };
  const cut = rest.indexOf(':');
  if (cut <= 0 || cut === rest.length - 1) return null;
  const provider = rest.slice(0, cut);
  const model = rest.slice(cut + 1);
  if (!/^[\w.-]+$/.test(provider) || !/^[\w.:-]+$/.test(model)) return null;
  return { kind: 'route', provider, model };
}

/**
 * The card and its keyboard.
 *
 * One button per route, labelled `provider · model` so the answer to "where do
 * the answers come from" is on the button itself. The current route is marked
 * and listed first in its group, because the first thing a person checks is
 * whether they are already on the route they want. Providers are named on a row
 * of their own rather than repeated on every button: seventeen buttons with a
 * provider prefix each is a wall, and a group heading stays readable when the
 * models have long names.
 */
export function modelCard({ profile, routes, current = null, topic = false, fallback = null, t, limit = 60 }) {
  const now = current || (routes.find((route) => route.current) || null);
  const isNow = (route) => Boolean(now && route.provider === now.provider && route.model === now.model);
  const known = routes.filter((route) => routeData(route.provider, route.model));
  const groups = routeGroups(known);
  const rows = [];
  let hidden = 0;
  let drawn = 0;
  let headings = 0;
  for (const group of groups) {
    if (drawn >= limit) {
      hidden += group.routes.length;
      continue;
    }
    // A heading is a button that does nothing, which is how a group is drawn
    // without inventing a message per provider. It carries no data, so it
    // cannot be pressed — the same trick the settings tabs avoid.
    if (group.provider) {
      rows.push([{ text: t('ctrl.model.pickGroup', { provider: group.provider }) }]);
      headings += 1;
    }
    for (const route of group.routes) {
      if (drawn >= limit) {
        hidden += 1;
        continue;
      }
      const mark = isNow(route) ? '✓ ' : '';
      rows.push([
        {
          text: `${mark}${route.model}`,
          data: routeData(route.provider, route.model),
        },
      ]);
      drawn += 1;
    }
  }
  rows.push([{ text: t('ctrl.model.pickRefresh'), data: `${MODEL_PREFIX}list` }]);
  // The way back to the profile, and only when there is something to go back
  // from: a button that clears a choice nobody made is a button that does
  // nothing and looks broken.
  if (topic) rows.push([{ text: t('ctrl.model.pickFollow'), data: `${MODEL_PREFIX}auto` }]);

  const lines = [t('ctrl.model.pickTitle', { profile })];
  if (now) {
    lines.push(t(topic ? 'ctrl.model.pickNowTopic' : 'ctrl.model.pickNow', { route: `${now.provider}/${now.model}` }));
    if (topic && fallback) {
      lines.push(t('ctrl.model.pickNowDefault', { route: `${fallback.provider}/${fallback.model}` }));
    }
  } else lines.push(t('ctrl.model.pickUnknown', { profile }));
  lines.push('');
  // Three different silences, and they are not the same fact: a profile with no
  // models at all, a profile whose every route is too long to be a button, and
  // one whose routes are simply cut off by the row cap below.
  if (routes.length === 0) lines.push(t('ctrl.model.pickNone', { profile }));
  else if (known.length === 0) lines.push(t('ctrl.model.pickLong', { profile }));
  else lines.push(t('ctrl.model.pickHint'));
  if (hidden > 0) lines.push(t('ctrl.model.pickHidden', { n: hidden }));
  return {
    text: lines.join('\n'),
    keyboard: rows,
    shown: drawn,
    headings,
    total: routes.length,
    current,
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
  // Every card this handler draws is this topic's, so the tick and the two
  // routes in the header come from one place — the same call the turn uses.
  const draw = () => {
    const route = topicRoute({ state: live, key });
    return modelCard({
      profile,
      routes: routesOf(profile),
      current: { provider: route.provider, model: route.model },
      topic: route.source === 'topic',
      fallback: route.source === 'topic' ? modelOf(profile) : null,
      t: (k, v) => t(lang, k, v),
    });
  };
  if (press.kind === 'list') {
    await redraw(draw());
    await answer(t(lang, 'ctrl.model.pickRefresh'));
    return true;
  }
  if (press.kind === 'auto') {
    clearTopicRoute(live, key);
    save();
    const route = topicRoute({ state: live, key });
    await say(t(lang, 'ctrl.model.topicCleared', { route: `${route.provider}/${route.model}` }));
    await redraw(draw());
    return true;
  }
  const wanted = `${press.provider}/${press.model}`;
  if (!routes.some((route) => route.provider === press.provider && route.model === press.model)) {
    await say(t(lang, 'ctrl.model.pickStale', { name: profile, route: wanted }));
    await redraw(draw());
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
  await redraw(draw());
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
        tg('editMessageText', {
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