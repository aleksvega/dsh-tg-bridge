// What a provider key has left, said in English.
export default {
  'balance.head': '💳 What is left on the provider keys',
  'balance.rowAccount': '• {provider}: account {amount} (key {key} — past its own grant)',
  'balance.row': '• {provider}: {amount}',
  'balance.empty': '• {provider}: empty — top up the account',
  'balance.unlimited': '• {provider}: no limit',
  'balance.noKey': '• {provider}: no key in the environment or the store',
  'balance.failed': '• {provider}: reports no balance',
  'balance.none': 'This profile has no providers — /endpoint list.',
  'balance.hint': 'The provider itself answers this, so it needs the network. An empty account is the first reason a route falls over to the next one: /fallback.',
};