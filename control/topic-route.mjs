// The model a topic answers with.
//
// One install, one profile, one model — that was the shape until now, and it is
// the wrong shape for the way this bot is used: a topic where somebody thinks
// out loud does not need the same model as a topic where an engineering problem
// is being solved, and moving the profile to serve one of them slows the other
// down or makes it dearer. So the choice belongs to the topic, and the profile
// keeps the default the topics that never chose follow.
//
// The storage is `state.route[key]` — the same per-topic map `reasoning`,
// `lang`, `pin` and `cwd` already use — and the route becomes a profile only
// when a turn is about to boot (`profileOf`).
import { modelOf, patchPath, read, routesOf } from './models.mjs';
import { providerRows } from '../model/model-probe.mjs';
import { ensureRouteProfile } from '../profile/profiles.mjs';

/** The route this topic runs, and where the answer came from. */
export function topicRoute({ state = {}, config = {}, key = '' } = {}) {
  const base = state.profile?.[key] || config.profile || 'headless';
  const own = state.route?.[key];
  if (own && own.model) {
    return { provider: own.provider || '?', model: own.model, base, source: 'topic' };
  }
  return { ...modelOf(base), base, source: 'profile' };
}

/** Store a route for one topic. Returns the topic's route as it now reads. */
export function setTopicRoute(state, key, route) {
  state.route = state.route || {};
  state.route[key] = { provider: String(route.provider || ''), model: String(route.model || '') };
  return state.route[key];
}

/** Forget a topic's own route, so it follows the profile again. */
export function clearTopicRoute(state, key) {
  if (state.route && key in state.route) {
    delete state.route[key];
    return true;
  }
  return false;
}

/**
 * The profile a turn for this topic must boot, or '' to keep the current one.
 *
 * Called on the way into a turn and nowhere else: it writes a profile directory,
 * and a card that says "this topic runs X" should not be the reason a file
 * appears on disk.
 */
export function routeProfile(base, route) {
  if (!route || !route.model) return '';
  return ensureRouteProfile(base, route);
}

/**
 * Does this route exist in the profile the topic would start from?
 *
 * A route is a claim about a provider *and* a model, so both are checked against
 * the profile's own patch. A button drawn from an older profile can outlive the
 * row it names — accepting it would write a route that cannot boot, which reads
 * as "the switch worked" right up to the first failed turn.
 */
export function routeExists(base, { provider = '', model = '' } = {}) {
  if (!model) return false;
  const text = read(patchPath(base));
  if (!text) return false;
  const routes = routesOf(base);
  return routes.some((row) => row.model === model && (!provider || row.provider === provider));
}

/** Provider ids the profile declares — what `/model <provider>/<model>` may name. */
export function providersOf(base) {
  return providerRows(read(patchPath(base))).map((row) => row.id).filter(Boolean);
}
