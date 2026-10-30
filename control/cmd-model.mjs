// `/model`: this topic's route, and the profile's default, in one card.
//
// The model used to be a property of the profile, and the profile is the whole
// install — so picking a model for an engineering topic moved the model for the
// topic where somebody thinks out loud, or the other way round. A model is a
// per-topic choice; the profile keeps the default that untouched topics follow.
//
// Extracted from `cmd-views.mjs` by the 500-line ceiling, and it holds together
// on its own: one card, one command, one idea of scope.
import { t } from '../i18n.mjs';
import { modelOf, routesOf, setModel } from './models.mjs';
import { modelCard } from './model-card.mjs';
import { clearTopicRoute, routeExists, setTopicRoute, topicRoute } from './topic-route.mjs';

export async function handleModelCommand(ctx) {
  const { arg, say, log, state, key, config, lang, profile } = ctx;
  const activeProfile = profile || config.profile || 'headless';
  const [wanted = '', scope = ''] = (arg || '').split(/\s+/);
  const topic = topicRoute({ state, config, key });
  const save = () => ctx.saveState?.() ?? ctx.save?.();

  if (!wanted) {
    // Bare `/model`: routes as buttons, and both scopes in the header — what this
    // chat answers on and what the profile serves — because the two can differ
    // and only one of them explains why this chat is fast or slow today.
    const routes = routesOf(activeProfile);
    const card = modelCard({
      profile: activeProfile,
      routes,
      current: routes.length ? { provider: topic.provider, model: topic.model } : null,
      topic: topic.source === 'topic',
      fallback: topic.source === 'topic' ? modelOf(activeProfile) : null,
      t: (k, v) => t(lang, k, v),
    });
    say(card.text, { keyboard: card.keyboard });
    return true;
  }

  // `/model auto` hands the topic back to the profile. Without it a choice made
  // once would follow the person into every future topic, which is the problem
  // the per-topic switch exists to solve.
  if (/^(auto|off|default|profile)$/i.test(wanted)) {
    const cleared = clearTopicRoute(state, key);
    save();
    const head = modelOf(activeProfile);
    say(t(lang, cleared ? 'ctrl.model.topicCleared' : 'ctrl.model.topicNone', {
      route: `${head.provider}/${head.model}`,
    }));
    return true;
  }

  if (scope === 'both' || scope === 'all' || scope === 'global') {
    // The default every topic without a choice reads. Same word as `/reasoning
    // off all`, so one habit covers both settings.
    if (!setModel(activeProfile, wanted)) {
      say(t(lang, 'ctrl.model.failed', { name: activeProfile, model: wanted }));
      return true;
    }
    const desktop = scope === 'both' ? setModel('desktop', wanted) : false;
    const route = modelOf(activeProfile);
    const kept = Object.keys(state.route || {}).length;
    const answer = t(lang, 'ctrl.model.switched', {
      name: activeProfile,
      model: `${route.provider}/${route.model}`,
      desktop: desktop ? t(lang, 'ctrl.model.withDesktop', { model: wanted }) : '',
    });
    // A default that does not reach every topic has to say so in the same breath,
    // or "now every topic" is a promise the next turn breaks.
    say(kept > 0 ? `${answer}\n${t(lang, 'ctrl.model.topicKept', { n: kept })}` : answer);
    return true;
  }

  // A bare route is this topic's, and only this topic's.
  const cut = wanted.indexOf('/');
  const route = cut > 0
    ? { provider: wanted.slice(0, cut), model: wanted.slice(cut + 1) }
    : { provider: '', model: wanted };
  if (!routeExists(activeProfile, route)) {
    // Same answer as a press on a stale button: the route is not in the profile,
    // so nothing is written and the message names the profile rather than a
    // silently ignored word.
    log(`/model ${wanted}: not a route of ${activeProfile}`);
    say(t(lang, 'ctrl.model.failed', { name: activeProfile, model: wanted }));
    return true;
  }
  setTopicRoute(state, key, route);
  save();
  const now = topicRoute({ state, config, key });
  const head = modelOf(activeProfile);
  say(t(lang, 'ctrl.model.topicSet', {
    route: `${now.provider}/${now.model}`,
    default: `${head.provider}/${head.model}`,
  }));
  return true;
}