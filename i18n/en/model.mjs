// The `/model` picker: every route a profile can run, as buttons.
//
// Its own table because the card is a screen of its own — the settings card and
// the command list each have one, and a picker that answers "where do the
// answers come from" belongs with them rather than in the middle of the
// control strings.
export default {
  'ctrl.model.pickTitle': '🎛 Routes of profile {profile}',
  'ctrl.model.pickNow': 'Now: {route}',
  'ctrl.model.pickNowTopic': 'This topic: {route}',
  'ctrl.model.pickNowDefault': 'Profile default: {route} — every topic that did not choose',
  'ctrl.model.pickFollow': '↩ Follow the profile again',
  'ctrl.model.topicSet': 'This topic now answers on {route}. Other topics keep {default}.',
  'ctrl.model.topicCleared': 'This topic follows the profile again: {route}.',
  'ctrl.model.topicNone': 'This topic had no route of its own; it follows the profile: {route}.',
  'ctrl.model.topicKept': '{n} topic(s) chose their own route and keep it.',
  'ctrl.model.pickUnknown': 'Now: profile {profile} has no default model line',
  'ctrl.model.pickGroup': '— {provider} —',
  'ctrl.model.pickHint': 'Tap a route to switch. The provider and the model change together, because the same model name can be served by several endpoints.',
  'ctrl.model.pickRefresh': '↻ Refresh',
  'ctrl.model.pickHidden': '{n} more route(s) do not fit; /model <provider>/<model> names any of them.',
  'ctrl.model.pickLong': 'Every route of profile {profile} has a name too long to fit on a button; /model <provider>/<model> still switches to any of them.',
  'ctrl.model.pickNone': 'Profile {profile} declares no models to choose from.',
  'ctrl.model.pickSwitched': 'Route {name} → {route}. Applies from the next turn.',
  'ctrl.model.pickStale': 'Profile {name} does not declare {route} any more — the profile changed since the card was drawn. /model to see the routes it has now.',
  'ctrl.model.scopeAllOn': '🌍 Changing everywhere ▸ tap for this topic only',
  'ctrl.model.scopeTopicOn': '💬 Changing this topic ▸ tap for everywhere',
  'ctrl.model.scopeAllHead': 'Mode "everywhere": the profile default is {route}. Tapping a route moves every topic that has no route of its own.',
  'ctrl.model.scopeAllHint': 'Pick a route and it becomes the default for the whole profile. Topics with their own route keep it — switch those one at a time in "this topic" mode.',
  'ctrl.model.scopeAllSet': 'A tap now changes the whole profile.',
  'ctrl.model.scopeTopicSet': 'A tap now changes only this topic.',
};