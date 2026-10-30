// `/endpoint`: the provider list, and adding one from the chat.
//
// A file of its own so the command's words live together: what the list shows,
// what a refusal says, and what a success promises — the promise is "a new
// button on /model", which is the reason a person added the endpoint at all.
export default {
  'ctrl.endpoint.listHead': '🔌 Endpoints of {profile} ({n})',
  'ctrl.endpoint.empty': 'Profile {profile} declares no endpoints. Add one with /endpoint add <id> <https://url/v1> <KEY_ENV> [model,model]',
  'ctrl.endpoint.models': 'model(s)',
  'ctrl.endpoint.noUrl': 'no baseURL',
  'ctrl.endpoint.inUse': '✓ ',
  'ctrl.endpoint.listHint': 'Add or replace one:\n`/endpoint add <id> <https://url/v1> <KEY_ENV> [model,model]`\nRemove one:\n`/endpoint rm <id>`\nThe key itself is never typed here — only the name of the environment variable that holds it.',
  'ctrl.endpoint.addForm': 'id is lowercase letters, digits and dashes. baseURL must be https (http only for localhost). KEY_ENV is the name of the variable holding the key, like MYROUTER_API_KEY. Models are optional and comma-separated.',
  'ctrl.endpoint.added': 'Endpoint {id} added to {profile}; {n} model(s): {models}. The next turn can use it, and /model shows its routes.',
  'ctrl.endpoint.updated': 'Endpoint {id} updated in {profile}. {n} model(s) added: {models}.',
  'ctrl.endpoint.removed': 'Endpoint {id} removed from {profile}.',
  'ctrl.endpoint.unchanged': 'Endpoint {id} already says exactly that — nothing to change.',
  'ctrl.endpoint.addedNoModels': 'Endpoint {id} added to {profile}, with no models yet. Name them when you know them: /endpoint add {id} <https://url/v1> <KEY_ENV> model1,model2',
  'ctrl.endpoint.updatedNoModels': 'Endpoint {id} updated in {profile}; no new models.',
  'ctrl.endpoint.nowPick': '/model draws {n} route(s) of {id} as buttons.',
  'ctrl.endpoint.why.usage': 'Usage:\n`/endpoint list`\n`/endpoint add <id> <https://url/v1> <KEY_ENV> [model,model]`\n`/endpoint rm <id>`\n{form}',
  'ctrl.endpoint.why.badId': '{id} is not a usable id: lowercase letters, digits and dashes, starting with a letter, up to 31 characters.',
  'ctrl.endpoint.why.url_insecure': 'That URL is not https. An endpoint carries an API key on every request, so a plain-http one would publish it — http is allowed only for localhost.',
  'ctrl.endpoint.why.url_notUrl': 'That is not a URL. It needs the scheme and the host, like `https://api.example.com/v1`.',
  'ctrl.endpoint.why.url_empty': 'The base URL is missing.',
  'ctrl.endpoint.why.key_empty': 'The key variable name is missing.',
  'ctrl.endpoint.why.key_notName': 'That looks like a key, not the name of one. Type the variable name (`MYROUTER_API_KEY`) — the key itself goes into the environment, never into the chat.',
  'ctrl.endpoint.why.badModel': '{model} is not a model id the patch can carry: letters, digits, dots, dashes, underscores and colons.',
  'ctrl.endpoint.why.missing': 'Profile {profile} has no endpoint by that id. `/endpoint list` shows the ones it has.',
  'ctrl.endpoint.why.noProviders': 'This profile has no `providers:` block to add an endpoint to — it is not a profile that names endpoints, so there is nothing to edit safely.',
  'ctrl.help.about.endpoint': "The endpoints this profile can reach, and adding one without an AI turn: /endpoint list, /endpoint add <id> <https://url/v1> <KEY_ENV> [model,model], /endpoint rm <id>. Only the name of the variable holding the key is typed — the key stays in the environment. A new model appears on /model as a button.",
};