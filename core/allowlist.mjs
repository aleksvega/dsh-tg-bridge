/**
 * Whether an update is from someone the bot serves.
 *
 * Small and separate on purpose: `bridge.mjs` starts polling the moment it is
 * imported, so the one rule that decides who may talk to the agent has to be
 * testable without booting the bot. An empty allowlist refuses everything — a
 * bot that answers strangers shows them the owner's work, and the steer path
 * reads like an ordinary message once it reaches the agent.
 */
export function allowedSender(msg, config) {
  const ids = config?.allowedUserIds || [];
  const from = msg?.from?.id;
  const chat = msg?.chat?.id;
  return ids.includes(from) || ids.includes(chat);
}
