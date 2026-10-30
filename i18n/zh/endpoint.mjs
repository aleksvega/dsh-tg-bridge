// `/endpoint`: the provider list, and adding one from the chat.
//
// A file of its own so the command's words live together: what the list shows,
// what a refusal says, and what a success promises — the promise is "a new
// button on /model", which is the reason a person added the endpoint at all.
export default {
  'ctrl.endpoint.listHead': '🔌 {profile} 的端点（{n}）',
  'ctrl.endpoint.empty': '配置档 {profile} 没有端点。添加一个：/endpoint add <id> <https://url/v1> <KEY_ENV> [模型,模型]',
  'ctrl.endpoint.models': '个模型',
  'ctrl.endpoint.noUrl': '没有 baseURL',
  'ctrl.endpoint.inUse': '✓ ',
  'ctrl.endpoint.listHint': '添加或替换：\n`/endpoint add <id> <https://url/v1> <KEY_ENV> [模型,模型]`\n删除：\n`/endpoint rm <id>`\n密钥本身不要写在这里 —— 只写存放它的环境变量名。',
  'ctrl.endpoint.addForm': 'id 用小写字母、数字和连字符。baseURL 必须是 https（只有 localhost 可以用 http）。KEY_ENV 是存放密钥的变量名，例如 MYROUTER_API_KEY。模型可选，用逗号分隔。',
  'ctrl.endpoint.added': '端点 {id} 已加入 {profile}；{n} 个模型（{models}）。下一轮就能用它，/model 会显示它的线路。',
  'ctrl.endpoint.updated': '端点 {id} 已在 {profile} 中更新。新增 {n} 个模型（{models}）。',
  'ctrl.endpoint.removed': '端点 {id} 已从 {profile} 移除。',
  'ctrl.endpoint.unchanged': '端点 {id} 本来就是这些内容 —— 没有要改的。',
  'ctrl.endpoint.addedNoModels': '端点 {id} 已加入 {profile}，暂时没有模型。知道后写进去：/endpoint add {id} <https://url/v1> <KEY_ENV> 模型1,模型2',
  'ctrl.endpoint.updatedNoModels': '端点 {id} 已在 {profile} 中更新；没有新模型。',
  'ctrl.endpoint.nowPick': '/model 会把 {id} 的 {n} 条线路画成按钮。',
  'ctrl.endpoint.why.usage': '用法：\n`/endpoint list`\n`/endpoint add <id> <https://url/v1> <KEY_ENV> [模型,模型]`\n`/endpoint rm <id>`\n{form}',
  'ctrl.endpoint.why.badId': '{id} 不能用作 id：小写字母、数字和连字符，以字母开头，最多 31 个字符。',
  'ctrl.endpoint.why.url_insecure': '这不是 https。端点每次请求都会带上 API 密钥，走明文 http 等于把它公开 —— 只有 localhost 允许 http。',
  'ctrl.endpoint.why.url_notUrl': '这不像 URL。需要协议和主机，例如 `https://api.example.com/v1`。',
  'ctrl.endpoint.why.url_empty': '缺少 base URL。',
  'ctrl.endpoint.why.key_empty': '缺少密钥变量名。',
  'ctrl.endpoint.why.key_notName': '这看起来是密钥本身，需要的是它的名字。写变量名（`MYROUTER_API_KEY`）—— 密钥放在环境里，不要放进对话。',
  'ctrl.endpoint.why.badModel': '{model} 不能用作模型 id：字母、数字、点、连字符、下划线和冒号。',
  'ctrl.endpoint.why.missing': '配置档 {profile} 没有这个 id 的端点。`/endpoint list` 会显示现有的。',
  'ctrl.endpoint.why.noProviders': '这个配置档没有 `providers:` 段，它不声明端点，所以没有可以安全修改的地方。',
  'ctrl.help.about.endpoint': "本配置档可以访问的端点，以及不经过模型回合直接添加：/endpoint list、/endpoint add <id> <https://url/v1> <KEY_ENV> [模型,模型]、/endpoint rm <id>。只输入存放密钥的变量名 —— 密钥留在环境里。新模型会以按钮出现在 /model。",
};