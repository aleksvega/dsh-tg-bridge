// What a provider key has left, said in Chinese.
export default {
  'balance.head': '💳 各提供商密钥余额',
  'balance.rowAccount': '• {provider}：账户 {amount}（密钥 {key} — 已超出自身额度）',
  'balance.row': '• {provider}：{amount}',
  'balance.empty': '• {provider}：已用尽 — 请充值',
  'balance.unlimited': '• {provider}：无限制',
  'balance.noKey': '• {provider}：环境变量和密钥库中都没有密钥',
  'balance.failed': '• {provider}：不提供余额',
  'balance.none': '当前配置没有提供商 — /endpoint list。',
  'balance.hint': '余额由提供商自己给出，因此需要网络。账户为空是路由切换到备用线路的首要原因：/fallback。',
};
