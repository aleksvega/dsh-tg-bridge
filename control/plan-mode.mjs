// Plan mode: a per-topic promise that this turn will not touch the machine.
//
// The desktop app has a plan switch the host writes into the session log. A
// Telegram turn cannot flip that, and telling the person "plan mode is a host
// switch" (which is what `/plan` said until now) is true but useless. So the
// bridge keeps its own switch: a per-topic flag that changes what the turn is
// asked for, plus a card that releases the work once the plan is read.
//
// The flag is a promise, not a wall, and the card says which of the two it is.
// When the topic's permission preset is `read-only` the sandbox itself refuses a
// write, so the guarantee is the machine's. On any other preset the only thing
// stopping a write is the instruction in the prompt — and a card that claimed
// otherwise would be lying about the single property the person relies on.
import { t } from '../core/i18n.mjs';
import { read, patchPath } from './models.mjs';
import { effectivePreset } from '../profile/permission-rows.mjs';
import { profileOf } from '../turn/turn.mjs';

/** The plan state of one topic, or null when plan mode is off. */
export function planOf(state, key) {
  const held = state?.planMode?.[key];
  return held && held.on ? held : null;
}

/** The prompt block that turns a work request into a planning request. */
export function planPrompt(lang) {
  return t(lang, 'prompt.planMode');
}

/**
 * The blocks that precede the person's own words in a turn.
 *
 * One function so `handle-message` does not grow a second copy of the order, and
 * because plan mode must be read at send time: a `/plan off` typed while an
 * earlier turn still runs is honoured by the next one.
 */
export function planPrelude({ state, key, lang, preface, text }) {
  const plan = planOf(state, key) ? `\n\n---\n\n${planPrompt(lang)}` : '';
  return `${preface}${plan}\n\n---\n\n${text}`;
}

/**
 * Whether the sandbox enforces read-only for this topic.
 *
 * Read from the topic profile's own patch, the same file the host loads, so the
 * sentence on the card is about the machine this turn actually runs on.
 */
export function sandboxEnforces(key) {
  const profile = profileOf(key);
  if (!profile) return false;
  const patch = read(patchPath(profile));
  if (!patch.trim()) return false;
  const preset = effectivePreset(patch);
  return Boolean(preset && preset.sandbox === 'read-only');
}

/** The card that follows a plan: what was promised, and the two ways forward. */
export function planCard(lang, key, id) {
  const enforced = sandboxEnforces(key);
  return {
    text: [
      t(lang, 'ctrl.planmode.cardHead'),
      '',
      enforced ? t(lang, 'ctrl.planmode.guaranteeSandbox') : t(lang, 'ctrl.planmode.guaranteeModel'),
    ].join('\n'),
    keyboard: [[
      { text: t(lang, 'ctrl.planmode.approve'), data: `pm:ok:${id}` },
      { text: t(lang, 'ctrl.planmode.keep'), data: `pm:more:${id}` },
    ]],
  };
}

/** How much of the person's own words a card keeps. A prompt, not an archive. */
export const MAX_REQUEST = 4000;

/**
 * Remember what was asked and put the card under the plan.
 *
 * A fresh id every turn is the whole stale check: the previous card's id stops
 * matching the moment the next plan arrives, so a late tap on it runs nothing.
 */
export async function planFollowUp({ state, key, lang, request, send, saveState }) {
  const held = planOf(state, key);
  if (!held) return false;
  held.id = `p${Date.now().toString(36)}`;
  held.request = String(request || '').slice(0, MAX_REQUEST);
  held.at = Date.now();
  saveState();
  const card = planCard(lang, key, held.id);
  await send(card.text, { inline_keyboard: card.keyboard });
  return true;
}
