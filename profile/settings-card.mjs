/**
 * The settings card: one message, buttons grouped by what they change, and every
 * row labelled with the setting it flips and what that means.
 *
 * Why a card at all: the command surface has grown past the point where a person
 * can remember which of thirty stems belongs to models and which to disk, and a
 * wrong guess costs a `/help` read. A card is the same switches a desktop app
 * draws — one line per setting, a tap to flip it — and it is deletable, so the
 * history is not a wall of menus.
 *
 * The card stays after a press. An earlier version turned it into one line naming
 * the change, which answered "what did I just do" and took away "what can I do
 * next": the menu vanished the moment it was used, and the way out had to be the
 * person deleting a message by hand. So a press now edits the card in place — same
 * message, same buttons, the new value marked — and the one line saying what
 * changed sits above the rows. Removing it is a button of its own (`✓ Done`),
 * which is the difference between a thing that stays and a thing that traps.
 *
 * Design rule, and the reason this file has no settings logic of its own: a
 * button runs the command a person would have typed. `m:reasoning:on` becomes
 * `/reasoning on` and goes through `handleControl`, so the card cannot validate,
 * translate or store a value differently from the command, and a new command
 * turns into a button by adding a row here — nothing else.
 */
import { reasoningMode } from '../chat/notes.mjs';

/**
 * A row is one setting. `values` are the ends a card offers (only where a pair is
 * genuinely enough — a long validated list opens its command instead);
 * `command` is what a tap sends, with `{v}` filled in. `on` is the value that
 * counts as "on" when the row is a switch, `field` the key the current value is
 * read from, and `labels` the strings that name each end. The `label` key is the
 * row's own name.
 */
const PAGES = {
  // What the bot says, and in which language.
  reply: [
    // Three ends, one row: the trail is off, in the card, or in the chat. The
    // card marks whichever end is the current mode, so a tap on ● does nothing
    // surprising and a tap on a ○ is the only thing that changes anything.
    {
      id: 'reasoning',
      field: 'reasoning',
      values: ['card', 'chat', 'off'],
      command: '/reasoning {v}',
      labels: { card: 'settings.reasoning.card', chat: 'settings.reasoning.chat', off: 'settings.state.off' },
    },
    // The same three answers, for every other topic at once. A separate row
    // rather than a hidden modifier: "quiet everywhere, talkative here" is the
    // shape people actually want, and it needs both halves visible side by side.
    {
      id: 'reasoningAll',
      field: 'reasoningAll',
      values: ['card', 'chat', 'off'],
      command: '/reasoning {v} all',
      labels: { card: 'settings.reasoning.card', chat: 'settings.reasoning.chat', off: 'settings.state.off' },
    },
    { id: 'lang', field: 'lang', values: ['en', 'ru', 'zh'], on: 'auto', command: '/lang {v}', labels: {} },
    // The card that shows the numbers can hold the one pinned slot the chat has,
    // so getting back to it is a tap rather than a scroll back through a turn.
    {
      id: 'pin',
      field: 'pin',
      values: ['on', 'off'],
      command: '/pin {v}',
      labels: { on: 'settings.state.on', off: 'settings.state.off' },
    },
    { id: 'thoughts', command: '/thoughts' },
  ],
  // Who answers and how hard it works. These open the command that owns the
  // value: the model list, the effort ladder and the permission presets are long
  // and validated, and a card that guessed would be a second, wrong editor.
  agent: [
    { id: 'model', command: '/model' },
    { id: 'effort', command: '/effort' },
    { id: 'permissions', command: '/permissions' },
    { id: 'preset', command: '/preset' },
    { id: 'set', command: '/agentset' },
    { id: 'agents', command: '/agents' },
    // The two doors a person reaches for from the chat more often than the rest:
    // which project this topic works in, and what answers when the provider
    // refuses. Both already have a card of their own; the row is just the way in.
    { id: 'cd', command: '/cd' },
    { id: 'fallback', command: '/fallback' },
  ],
  // New releases: install-wide, so the row is about the install, not the topic.
  updates: [
    { id: 'u-late', values: ['on', 'off'], on: 'on', command: '/update {v}', labels: { on: 'settings.state.on', off: 'settings.state.off' } },
    { id: 'u-auto', values: ['auto'], on: 'auto', command: '/update {v}', labels: { auto: 'settings.state.auto' } },
    { id: 'u-install', command: '/update confirm' },
    { id: 'u-now', command: '/version' },
  ],
  // What the install has done lately: the questions asked when something broke.
  health: [
    { id: 'status', command: '/status' },
    { id: 'doctor', command: '/doctor' },
    { id: 'logs', command: '/logs errors' },
    { id: 'jobs', command: '/jobs' },
    { id: 'help', command: '/help' },
  ],
};

/** Page order in the tab row. */
export const SETTINGS_PAGES = Object.keys(PAGES);

/** The one callback payload grammar the router accepts from this card. */
export const SET_PREFIX = 'm:';

/** Telegram's ceiling on callback payloads. */
const MAX_PAYLOAD = 64;

/** Fill `{v}` without touching anything else a command might contain. */
const withValue = (command, value) => String(command || '').replace('{v}', String(value ?? ''));

/** A value as a person reads it: "on" as the word "on", a language as "en". */
const wordFor = (row, value, t) => (row.labels?.[value] ? t(row.labels[value]) : String(value));

/**
 * Every button on every page, resolved for one topic.
 *
 * `active` is computed per row family instead of by one formula: a switch marks
 * the end that equals the current truth, a language row marks the pinned
 * language, and the update rows mark the policy they describe.
 */
export function settingsButtons({ t, current = {}, updateMode = 'check' }) {
  const buttons = [];
  for (const [page, rows] of Object.entries(PAGES)) {
    for (const row of rows) {
      const ends = row.values || [null];
      for (const value of ends) {
        const data = value ? `${SET_PREFIX}${row.id}:${value}` : `${SET_PREFIX}${row.id}`;
        if (data.length > MAX_PAYLOAD) throw new Error(`payload too long: ${data}`);
        let active = false;
        if (row.field === 'reasoning') active = current.reasoning === value;
        else if (row.field === 'reasoningAll') active = current.reasoningAll === value;
        else if (row.field === 'lang') active = current.lang === value;
        else if (row.field === 'pin') active = current.pin === value;
        else if (row.id === 'u-late') active = value === 'on' ? updateMode !== 'off' : updateMode === 'off';
        else if (row.id === 'u-auto') active = updateMode === value;
        buttons.push({
          page,
          row,
          id: row.id,
          value,
          data,
          command: value ? withValue(row.command, value) : row.command,
          label: t(`settings.${row.id}.label`),
          hint: t(`settings.${row.id}.hint`),
          active,
        });
      }
    }
  }
  return buttons;
}

/**
 * What the card reads as the current values. Every field comes from the same
 * place the matching command reads it, so a `●` cannot lie.
 */
export function settingsCurrent({ config = {}, state = {}, key = '' }) {
  return {
    reasoning: reasoningMode(state, config, key),
    // The default, read by asking for a topic that cannot exist: the same
    // function decides both, so the `●` on the global row is never a guess.
    reasoningAll: reasoningMode(state, config, ''),
    lang: state.lang?.[key] || 'auto',
    pin: cardPin(state, config, key),
    // Who answered the last turn that finished: the topic's route is what this
    // card configures, but after a fallback the honest answer is the model that
    // actually replied — and the card is where a person looks to check.
    answered: state.answered?.[key] || null,
  };
}

/**
 * Is the progress card pinned while its turn runs?
 *
 * Per-topic wins over the install default, and the default is off: pinning
 * somebody's chat uninvited takes the one slot Telegram gives a conversation, and
 * a group needs the right to pin at all. `true`/`false` read as on/off, the way
 * the notes switch migrated.
 */
export function cardPin(state, config, key = '') {
  const raw = state?.pin?.[key];
  if (raw === 'on' || raw === 'off') return raw;
  if (raw === true) return 'on';
  if (raw === false) return 'off';
  if (config?.pin === 'on' || config?.pin === true) return 'on';
  return 'off';
}

/** The line above the buttons: what a tap on this row changes it to. */
function rowLine(button, group, t) {
  if (!button.value) return t('settings.row.action', { label: button.label, hint: button.hint });
  const active = group.find((b) => b.active);
  // The filled dot is layout, not language, so it is added here: the same mark
  // sits on the button and on the value the card names in words. A person who
  // scans only the text still sees which end is in force.
  const now = active ? `● ${wordFor(active.row, active.value, t)}` : t('settings.notSet');
  const next = group.filter((b) => !b.active && b.value).map((b) => wordFor(b.row, b.value, t)).join(' / ');
  return t('settings.row.toggle', { label: button.label, now, next, hint: button.hint });
}

/**
 * One page: the text above the buttons, the rows of the keyboard, and the tab
 * row. The text names each setting, what it is now and what a tap would do — the
 * explanation the commands never had to give, because the person typed them
 * knowing what they do.
 */
export function renderSettingsCard({ page = 'reply', t, current = {}, updateMode = 'check', bound = null, note = '' }) {
  const buttons = settingsButtons({ t, current, updateMode }).filter((b) => b.page === page);
  const lines = [t(`settings.${page}.title`), ''];
  // What the last tap did, in one line above the rows: the card stays, so the
  // change needs somewhere to be said, and the top is where the eye lands.
  if (note) lines.push(note, '');

  // One line per row, in the order the rows declare.
  const byId = new Map();
  for (const button of buttons) byId.set(button.id, [...(byId.get(button.id) || []), button]);
  for (const group of byId.values()) lines.push(rowLine(group[0], group, t));

  // The permission row opens a command instead of toggling, so its current value
  // has to be spelled out here: `current.permissions` comes from the profile this
  // topic actually boots, which for a bound topic is not the install's profile.
  if (page === 'agent' && current.permissions) {
    lines.push(t('settings.agent.permission', {
      preset: current.permissions.preset || t('settings.notSet'),
      profile: current.permissions.profile || '',
    }));
  }
  // Who actually answered last, and whether that was the chain rather than this
  // topic's own route. The card names the route it configures a few rows above,
  // so without this line a topic running on a fallback looks like it is running
  // on the route printed there.
  if (page === 'agent' && current.answered?.model) {
    lines.push(t(current.answered.switched ? 'model.answeredSwitched' : 'model.answered', {
      model: current.answered.model,
    }));
  }
  if (page === 'reply' && bound) lines.push('', t('settings.reply.setBound', { name: bound.name || bound.id }));
  lines.push('', t('settings.card.foot'));

  // Doors get their own full-width row so they read as actions; switches sit
  // together; the way out, then tabs last, because they switch the page, not the
  // setting. Only the value in force carries the dot — a card where every option
  // is marked says nothing about which one is on.
  const keyboard = [];
  for (const group of byId.values()) {
    if (!group[0].value) {
      keyboard.push(group.map((b) => ({ text: b.label, data: b.data })));
      continue;
    }
    keyboard.push(group.map((b) => ({ text: b.active ? `● ${wordFor(b.row, b.value, t)}` : wordFor(b.row, b.value, t), data: b.data })));
  }
  keyboard.push([{ text: t('settings.done'), data: `${SET_PREFIX}done` }]);
  keyboard.push(SETTINGS_PAGES.map((p) => ({
    text: p === page ? `— ${t(`settings.tab.${p}`)} —` : t(`settings.tab.${p}`),
    data: `${SET_PREFIX}${p}`,
  })));

  return { text: lines.join('\n'), keyboard, buttons };
}

/**
 * Turn a button payload into what it stands for: `{ tab }` for a tab,
 * `{ done: true }` for the way out, `{ command, label, page }` for a setting
 * (what to run, what to call it in the line above the rows, and which page to
 * redraw once it has run).
 *
 * The tab and the setting both need a page, and that is exactly how they got
 * confused: a switch that carried `page` was read as "show me that page", so a
 * press redrew an identical card and ran nothing — a dead button, with no error
 * anywhere to say so. `tab` names the one action that only changes the view.
 *
 * Unknown rows and unknown values answer `null`: a button from a message written
 * before this release is the normal case, not an error, and the caller says so in
 * one line instead of running something half-understood.
 */
export function commandFor({ t, current = {}, updateMode = 'check' }, data) {
  const text = String(data || '');
  if (!text.startsWith(SET_PREFIX)) return null;
  const [, row, value = ''] = text.split(':');
  // The way out is not a setting: it removes the card, which is the one action
  // the buttons could not do while a press turned the card into a line.
  if (row === 'done' && !value) return { done: true };
  // A tab carries its own page. It did not, and the press asked the renderer for
  // `undefined`, which fell back to `reply`: every tab redrew the page already on
  // screen, Telegram answered "message is not modified", and the only symptom was
  // a menu that did nothing. The page belongs in the answer, not in the caller.
  if (SETTINGS_PAGES.includes(row) && !value) return { tab: row, page: row };
  const button = settingsButtons({ t, current, updateMode }).find((b) => b.id === row && (b.value || '') === value);
  if (!button || !button.command) return null;
  return {
    command: button.command,
    label: button.label,
    value: button.value ? wordFor(button.row, button.value, t) : '',
    // The card is redrawn after the press, and a redraw needs to know which page
    // it is looking at: the payload does not carry it, the row does.
    page: button.page,
  };
}