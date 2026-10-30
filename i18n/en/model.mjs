// The `/model` picker: every route a profile can run, as buttons.
//
// Its own table because the card is a screen of its own — the settings card and
// the command list each have one, and a picker that answers "where do the
// answers come from" belongs with them rather than in the middle of the
// control strings.
export default {
  'ctrl.model.pickTitle': '🎛 Routes of profile {profile}',
  'ctrl.model.pickNow': 'Now: {route}',
  'ctrl.model.pickUnknown': 'Now: profile {profile} has no default model line',
  'ctrl.model.pickGroup': '— {provider} —',
  'ctrl.model.pickHint': 'Tap a route to switch. The provider and the model change together, because the same model name can be served by several endpoints.',
  'ctrl.model.pickRefresh': '↻ Refresh',
  'ctrl.model.pickHidden': '{n} more route(s) do not fit; /model <provider>/<model> names any of them.',
  'ctrl.model.pickLong': 'Every route of profile {profile} has a name too long to fit on a button; /model <provider>/<model> still switches to any of them.',
  'ctrl.model.pickNone': 'Profile {profile} declares no models to choose from.',
  'ctrl.model.pickSwitched': 'Route {name} → {route}. Applies from the next turn.',
  'ctrl.model.pickStale': 'Profile {name} does not declare {route} any more — the profile changed since the card was drawn. /model to see the routes it has now.',
};