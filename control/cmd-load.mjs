// `/load`: what this computer is doing, and the guard that keeps it usable.
//
// One group of the `/` surface. `control.mjs` owns the dispatch and this file
// owns the command.
import { normalizeLang, t } from '../i18n.mjs';
import { guardOf, sampleMachine } from '../machine.mjs';
import { loadPress, renderLoadCard } from '../load-card.mjs';
import { saveConfig } from '../state.mjs';

/** The card, drawn once and reused by every verb that ends in "show me". */
async function drawLoad({ ctx, lang, guard }) {
  const jobs = ctx.jobs ? ctx.jobs() : { active: [], queued: 0, max: 0 };
  const sample = await sampleMachine({ drive: undefined });
  const card = renderLoadCard({
    t: (key, vars) => t(lang, key, vars),
    sample,
    guard,
    turns: jobs.active.length,
    queued: jobs.queued,
    max: jobs.max,
  });
  await ctx.reply(card.text, { reply_markup: { inline_keyboard: card.keyboard } });
}

export async function handleLoadCommands(ctx) {
  const { command, arg, reply, log, config, lang: rawLang } = ctx;
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const effective = ctx.effective || command;
  if (effective !== '/load') return false;

  const guard = guardOf(config.loadGuard);
  const verb = String(arg || '').trim().toLowerCase();
  if (!verb) {
    await drawLoad({ ctx, lang, guard });
    return true;
  }
  if (verb === 'on' || verb === 'off' || verb === 'guard') {
    const want = verb === 'guard' ? !guard.enabled : verb === 'on';
    config.loadGuard = { ...guard, enabled: want };
    saveConfig();
    log(`load guard ${want ? 'on' : 'off'}: cpu>${guard.cpuPct}%, ram<${guard.ramFreePct}%, disk<${guard.diskFreeGb}GB`);
    await drawLoad({ ctx, lang, guard: { ...guard, enabled: want } });
    return true;
  }
  // `/load limit cpu 80` — one number at a time, because a person changing the
  // limit is looking at the reading that annoyed them.
  const [, what, raw] = /^(?:limit|l)\s+(cpu|ram|disk)\s+(\d+(?:[.,]\d+)?)$/.exec(verb) || [];
  if (what) {
    const value = Number(String(raw).replace(',', '.'));
    const field = what === 'cpu' ? 'cpuPct' : what === 'ram' ? 'ramFreePct' : 'diskFreeGb';
    const next = { ...guard, [field]: value };
    config.loadGuard = next;
    saveConfig();
    log(`load limit ${field}=${value}`);
    await drawLoad({ ctx, lang, guard: next });
    return true;
  }
  if (verb === 'limit' || verb === 'limits') {
    await reply(t(lang, 'ctrl.load.limitsNow', { cpu: guard.cpuPct, ram: guard.ramFreePct, disk: guard.diskFreeGb }));
    return true;
  }
  await reply(t(lang, 'ctrl.load.usage'));
  return true;
}

export { loadPress };
