// The plugin settings card: a profile's `cordis.patch.yml` as the rows and
// switches it actually holds.
//
// The desktop app draws a settings page per plugin from the plugin's own schema.
// The bridge has no such channel — a headless turn has no client to ask — so it
// reads the one file that decides what the host loads. Inside a row's flat
// `config:`, a `true`/`false` is a switch, because a tap can change it; anything
// else is printed as a value, because a button cannot honestly type a number, and
// a control that cannot change what it shows is the dead switch this card exists
// to avoid.
//
// Two levels, because one page of forty rows is not a card: the list names the
// plugins that have settings, and each button opens one plugin.
//
// A button carries a position, not a name: a callback payload is 64 bytes and a
// package name is longer than that alone. Positions are written into the topic's
// state when the card is drawn, so a press on a card from before an edit resolves
// to nothing and says "out of date" instead of flipping whatever now sits there.
//
// Every press re-reads the profile, and the write is read back: the line in the
// chat names the value the file holds now, never the value that was asked for.
import { t } from '../core/i18n.mjs';
import { config, state, saveState } from '../core/state.mjs';
import { pluginConfigOf, settingsRows, writePluginSetting } from '../control/plugin-settings.mjs';

/** A value as the card shows it: `true`/`false` as words, everything else as written. */
function shown(value, type, lang) {
  if (type === 'boolean') return t(lang, value ? 'settings.state.on' : 'settings.state.off');
  return String(value);
}

/** Where the buttons of the last list this profile drew point, one id per button. */
function rememberRows(activeProfile, ids) {
  state.psRows ??= {};
  state.psRows[activeProfile] = ids;
  saveState();
}

/** Where the switches of the last card this topic drew point: `{id, keys}`. */
function rememberCard(topicKey, id, keys) {
  state.psCard ??= {};
  state.psCard[topicKey] = { id, keys };
  saveState();
}

/** The list of plugins that have settings, one button each. */
export function pluginSettingsList(lang, activeProfile) {
  const rows = settingsRows(activeProfile);
  if (rows.length === 0) return { text: t(lang, 'ctrl.ps.empty', { profile: activeProfile }), keyboard: [] };
  const lines = [t(lang, 'ctrl.ps.title', { profile: activeProfile, n: rows.length }), ''];
  for (const row of rows) lines.push(t(lang, 'ctrl.ps.row', { id: row.id, pkg: row.pkg, n: row.count }));
  lines.push('', t(lang, 'ctrl.ps.listHint'));
  return {
    text: lines.join('\n'),
    keyboard: rows.map((row, i) => [{ text: row.id.slice(0, 40), data: `ps:r:${i}` }]),
  };
}

/**
 * One plugin's own card: every config key, a switch for the booleans.
 *
 * @returns {{text: string, keyboard: object[], id: string, keys: string[]}}
 */
export function pluginSettingsCard(lang, activeProfile, rowId) {
  const found = pluginConfigOf(activeProfile, rowId);
  if (!found.ok) {
    const why = found.why === 'missingProfile' ? 'ctrl.ps.noProfile' : 'ctrl.ps.gone';
    return { text: t(lang, why, { profile: activeProfile, id: rowId }), keyboard: [], id: '', keys: [] };
  }
  const lines = [t(lang, 'ctrl.ps.head', { id: found.id, pkg: found.pkg || found.id, profile: activeProfile }), ''];
  const keys = [];
  for (const setting of found.settings) {
    if (setting.type === 'block') {
      // A nested table is a structure with its own editor. Naming its size is
      // honest; a toggle for it would not be.
      lines.push(t(lang, 'ctrl.ps.block', { key: setting.key, n: setting.lines }));
      continue;
    }
    lines.push(t(lang, setting.editable ? 'ctrl.ps.switch' : 'ctrl.ps.value', {
      key: setting.key,
      value: shown(setting.value, setting.type, lang),
    }));
    if (setting.editable) keys.push(setting.key);
  }
  if (found.settings.length === 0) lines.push(t(lang, 'ctrl.ps.none'));
  lines.push('', t(lang, 'ctrl.ps.foot'));
  const keyboard = [];
  for (const [at, name] of keys.entries()) {
    const on = found.settings.find((s) => s.key === name)?.value;
    // The label names the key and the end a tap moves it to: two switches of one
    // plugin often differ only in that word.
    keyboard.push([{ text: `${name}: ${t(lang, on ? 'settings.state.off' : 'settings.state.on')}`, data: `ps:t:${at}` }]);
  }
  keyboard.push([{ text: t(lang, 'ctrl.ps.back'), data: 'ps:list' }]);
  return { text: lines.join('\n'), keyboard, id: found.id, keys };
}

/** The card `/plugin settings` opens: the list, or one row when it is named. */
export function openPluginSettings(lang, activeProfile, rowId = '') {
  if (rowId) return pluginSettingsCard(lang, activeProfile, rowId);
  // The list is a photograph of the profile: the positions its buttons carry are
  // written now, so the next press can tell whether it still fits.
  rememberRows(activeProfile, settingsRows(activeProfile).map((row) => row.id));
  return pluginSettingsList(lang, activeProfile);
}

/** Redraw the message the press came from, keeping the card in place. */
async function redraw({ tg, inlineKeyboard, chatId, messageId, card }) {
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: card.text,
    ...(card.keyboard.length ? { reply_markup: { inline_keyboard: inlineKeyboard(card.keyboard) } } : {}),
  }).catch(() => {});
}

/**
 * Handle one `ps:` press.
 *
 * @returns {Promise<boolean>} true when the press was this module's to answer.
 */
export async function handlePluginSettingsPress({ data, key, lang, chatId, messageId, answer, tg, inlineKeyboard }) {
  const body = String(data || '');
  if (!body.startsWith('ps:')) return false;
  const activeProfile = config?.profile || 'headless';
  const draw = (card) => redraw({ tg, inlineKeyboard, chatId, messageId, card });

  if (body === 'ps:list') {
    const card = pluginSettingsList(lang, activeProfile);
    rememberRows(activeProfile, settingsRows(activeProfile).map((row) => row.id));
    await draw(card);
    await answer(t(lang, 'ctrl.ps.opened').slice(0, 190));
    return true;
  }

  if (body.startsWith('ps:r:')) {
    const at = Number(body.slice(5));
    const ids = state.psRows?.[activeProfile] || [];
    const rowId = Number.isInteger(at) ? ids[at] : '';
    // A plugin installed since the list was drawn shifted every position below
    // it: writing to the wrong row would be worse than asking for a fresh list.
    if (!rowId) {
      await answer(t(lang, 'ctrl.ps.stale'));
      return true;
    }
    const card = pluginSettingsCard(lang, activeProfile, rowId);
    rememberCard(key, card.id || rowId, card.keys);
    await draw(card);
    await answer(t(lang, 'ctrl.ps.opened').slice(0, 190));
    return true;
  }

  if (body.startsWith('ps:t:')) {
    const at = Number(body.slice(5));
    const held = state.psCard?.[key];
    const name = Number.isInteger(at) ? held?.keys?.[at] : '';
    if (!held?.id || !name) {
      await answer(t(lang, 'ctrl.ps.stale'));
      return true;
    }
    const before = pluginConfigOf(activeProfile, held.id);
    const setting = before.settings?.find((s) => s.key === name);
    if (!before.ok || !setting) {
      await answer(t(lang, 'ctrl.ps.stale'));
      return true;
    }

    const result = writePluginSetting(activeProfile, held.id, name, !setting.value);
    const card = pluginSettingsCard(lang, activeProfile, held.id);
    rememberCard(key, card.id || held.id, card.keys);
    await draw(card);
    if (!result.ok) {
      // The refusal names the value the file still holds: "the profile kept the old
      // value" is a different sentence from "the write failed", and only one is true.
      await answer(t(lang, result.why === 'readOnly' ? 'ctrl.ps.readOnly' : 'ctrl.ps.refused', {
        key: name,
        value: shown(setting.value, setting.type, lang),
      }).slice(0, 190));
      return true;
    }
    await answer(t(lang, 'ctrl.ps.saved', {
      key: name,
      value: shown(result.value, setting.type, lang),
      profile: activeProfile,
    }).slice(0, 190));
    return true;
  }
  return false;
}
