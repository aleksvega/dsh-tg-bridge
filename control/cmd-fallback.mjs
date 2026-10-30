// `/fallback`: the failover chain, as a card a person can change from the chat.
//
// The chain used to be a `config.json` key with no reader: a turn that failed on
// one vendor either switched to something nobody chose or, more often, did not
// switch at all, and the chat could not say why. The card answers "what is behind
// this route", and every button runs a verb of this command, so a tap and a typed
// line can never disagree.
//
// One group of the `/` surface. `control.mjs` owns the dispatch and this file owns
// the command.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeLang, t } from '../core/i18n.mjs';
import { DIR } from '../core/paths.mjs';
import { removeKeyboard, renderFallbackCard, renderProbe } from '../model/fallback-card.mjs';
import { labelOf } from '../model/fallback.mjs';
import { probeModel, providerRows } from '../model/model-probe.mjs';
import { modelOf, patchPath, read } from './models.mjs';

/** Provider ids as the profile spells them: a route on an unknown one cannot boot. */
function providerIds(profile) {
  return providerRows(read(patchPath(profile))).map((row) => row.id).filter(Boolean);
}

/** `router-a/kimi-k3:free` → `{provider, model}`; a bare id keeps the given provider. */
export function splitRoute(wanted, fallbackProvider = '') {
  const text = String(wanted || '').trim();
  const at = text.indexOf('/');
  if (at > 0) return { provider: text.slice(0, at), model: text.slice(at + 1) };
  return { provider: fallbackProvider, model: text };
}

/**
 * The overlay file one route needs, in the shape the shipped ones have.
 *
 * The host CLI has no `--patch`, so a route is a profile materialised from this
 * file by `ensureProfile()`; a chain entry without a readable overlay is a route
 * the turn silently skips, which is the failure this command exists to end.
 */
export function overlayText({ provider, model }) {
  return `- id: agent-default-model\n  config:\n    provider: ${provider}\n    model: ${model}\n`;
}

/**
 * Stable file name for a route: `model-<provider>-<model>.yml`.
 *
 * The shape the shipped overlays already have (`model-glm-5_3.yml`): dots and
 * dashes stay, because they are part of the model id, and a colon — the `:free`
 * suffix — becomes an underscore, because a colon is not a filename character on
 * Windows. The same route therefore gets the same file on every platform.
 */
export function overlayName({ provider, model }) {
  const slug = `${provider}-${model}`.replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '');
  return `model-${slug}.yml`;
}

/** What the chat calls a probe result. */
const VERDICT = {
  ok: 'ok',
  balance: 'balance',
  auth: 'auth',
  busy: 'busy',
  network: 'network',
  missing: 'missing',
  // A 200 with no body: the route took the request and said nothing. Saying "ok"
  // there is how a dead channel looks healthy on the card.
  empty: 'empty',
};

export async function handleFallbackCommands(ctx) {
  const { command, arg, reply, log, profile, config, lang: rawLang } = ctx;
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  if ((ctx.effective || command) !== '/fallback') return false;

  // Read fresh on every press: a button may arrive after another one already
  // reordered the chain, and acting on the card's copy would move the wrong route.
  const chain = Array.isArray(config.fallbackModels) ? config.fallbackModels : [];
  const enabled = config.fallbackEnabled !== false;
  const tr = (key, vars) => t(lang, key, vars);
  const save = () => {
    const ok = typeof ctx.saveConfig === 'function' ? ctx.saveConfig() : false;
    if (!ok) log('fallback: config.json was not written; the change lives until restart');
    return ok;
  };
  const card = (extra = '') => {
    const body = renderFallbackCard({ t: tr, chain, primary: modelOf(activeProfile), enabled });
    say(extra ? `${extra}\n\n${body.text}` : body.text, { keyboard: body.keyboard });
  };
  const done = (key, vars) => card(t(lang, save() ? key : 'ctrl.fallback.unsaved', vars));

  const [word = '', ...rest] = String(arg || '').trim().split(/\s+/).filter(Boolean);
  const verb = word.toLowerCase();
  const n = Number(rest[0] || word);
  const at = Number.isInteger(n) && n > 0 ? n - 1 : -1;
  const entry = at >= 0 ? chain[at] : null;
  // Answers and returns true in one step: a handler that says something and
  // returns falsy makes the button router claim the press was unknown.
  const missing = () => {
    say(t(lang, 'ctrl.fallback.noSuch', { n: rest[0] || word }));
    return true;
  };
  const setOff = (value) => {
    if (value) entry.off = true;
    else delete entry.off;
  };

  switch (verb) {
    case '':
    case 'show':
    case 's':
      card();
      return true;

    // The whole chain, on or off. Off is a promise: `runFallbackChain` reads the
    // key before it sends anything, so no turn can switch behind the switch.
    // With a number the same two words act on one route, because `off 3` is what
    // a person types after reading the list.
    case 'on':
    case 'off': {
      if (rest.length > 0) {
        if (!entry) return missing();
        setOff(verb === 'off');
        done('ctrl.fallback.toggled', { route: labelOf(entry), state: tr(entry.off ? 'ctrl.fallback.routeOff' : 'ctrl.fallback.routeOn') });
        return true;
      }
      config.fallbackEnabled = verb === 'on';
      done(verb === 'on' ? 'ctrl.fallback.chainOn' : 'ctrl.fallback.chainOff');
      return true;
    }

    // One route. The card's ● button sends `toggle`, and the two explicit words
    // exist for a typed line: a toggle cannot express "on", and a press that
    // arrives twice must land in the same state, not flip back.
    case 'use':
    case 'skip':
    case 'toggle': {
      if (!entry) return missing();
      if (verb === 'use') setOff(false);
      else if (verb === 'skip') setOff(true);
      else setOff(!entry.off);
      done('ctrl.fallback.toggled', { route: labelOf(entry), state: tr(entry.off ? 'ctrl.fallback.routeOff' : 'ctrl.fallback.routeOn') });
      return true;
    }

    case 'up':
    case 'down': {
      if (!entry) return missing();
      const to = verb === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= chain.length) {
        say(t(lang, 'ctrl.fallback.edge', { route: labelOf(entry) }));
        return true;
      }
      [chain[at], chain[to]] = [chain[to], chain[at]];
      done('ctrl.fallback.moved', { route: labelOf(entry), n: to + 1 });
      return true;
    }

    case 'remove': {
      if (!entry) return missing();
      // Only the chain entry goes: the overlay file may also be a vision patch,
      // and a file left behind costs a few bytes while a deleted one costs a turn.
      const [gone] = chain.splice(at, 1);
      done('ctrl.fallback.removed', { route: labelOf(gone) });
      return true;
    }

    case 'add': {
      const route = splitRoute(rest.join(' '));
      if (!route.model) {
        say(t(lang, 'ctrl.fallback.addUsage'));
        return true;
      }
      const known = providerIds(activeProfile);
      const provider = route.provider || known[0] || '';
      if (!known.includes(provider)) {
        say(t(lang, 'ctrl.fallback.unknownProvider', { name: provider || '?', list: known.join(', ') }));
        return true;
      }
      const full = `${provider}/${route.model}`;
      if (chain.some((item) => item.provider === provider && item.model === route.model)) {
        say(t(lang, 'ctrl.fallback.dupe', { route: full }));
        return true;
      }
      const patch = join(DIR, overlayName({ provider, model: route.model }));
      writeFileSync(patch, overlayText({ provider, model: route.model }), 'utf8');
      const fresh = { provider, model: route.model, patch };
      if (/:free$/i.test(route.model)) fresh.free = true;
      chain.push(fresh);
      log(`fallback: added ${full} at ${patch}`);
      done('ctrl.fallback.added', { route: full });
      return true;
    }

    // A route the person wants tried FIRST, not appended.
    //
    // `add` puts a route at the tail, which is right for a spare and wrong for
    // the one that should answer when the primary is busy: moving it up eight
    // times is eight presses, and the last one is always a guess about where the
    // head is. This is `add` plus "put it in front", in one word.
    case 'first':
    case 'head': {
      const route = splitRoute(rest.join(' '));
      if (!route.model) {
        say(t(lang, 'ctrl.fallback.addUsage'));
        return true;
      }
      const known = providerIds(activeProfile);
      const provider = route.provider || known[0] || '';
      if (!known.includes(provider)) {
        say(t(lang, 'ctrl.fallback.unknownProvider', { name: provider || '?', list: known.join(', ') }));
        return true;
      }
      const full = `${provider}/${route.model}`;
      // Already in the chain: move it instead of adding a twin. Two entries of
      // one route would be tried twice for the same failure.
      const existing = chain.findIndex((item) => item.provider === provider && item.model === route.model);
      if (existing === 0) {
        say(t(lang, 'ctrl.fallback.alreadyFirst', { route: full }));
        return true;
      }
      if (existing > 0) {
        const [moved] = chain.splice(existing, 1);
        chain.unshift(moved);
        done('ctrl.fallback.moved', { route: labelOf(moved), n: 1 });
        return true;
      }
      const patch = join(DIR, overlayName({ provider, model: route.model }));
      writeFileSync(patch, overlayText({ provider, model: route.model }), 'utf8');
      const fresh = { provider, model: route.model, patch };
      if (/:free$/i.test(route.model)) fresh.free = true;
      chain.unshift(fresh);
      log(`fallback: added ${full} at the head (${patch})`);
      done('ctrl.fallback.addedFirst', { route: full });
      return true;
    }

    // A probe proves the key works, not that this conversation is acceptable: the
    // hint says so, because "route is fine" beside a 400 would be a lie.
    //
    // Providers are asked in parallel, routes of ONE provider one after another:
    // seven routes at a 15-second timeout each is nearly two minutes of a command
    // that looks frozen, but five of those routes may sit on one key, and a burst
    // of seven requests is itself a rate limit. The probe would then report the
    // chain as busy and be right about the probe, wrong about the chain.
    case 'test':
    case 'x': {
      const targets = entry ? [entry] : chain;
      if (targets.length === 0) {
        say(t(lang, 'ctrl.fallback.empty'));
        return true;
      }
      const byProvider = new Map();
      for (const item of targets) {
        const id = item.provider || '';
        if (!byProvider.has(id)) byProvider.set(id, []);
        byProvider.get(id).push(item);
      }
      const verdicts = new Map();
      await Promise.all([...byProvider.values()].map(async (group) => {
        for (const item of group) verdicts.set(item, await probeModel(item.model, { provider: item.provider }));
      }));
      const rows = targets.map((item) => {
        const verdict = verdicts.get(item) || { kind: 'other' };
        log(`fallback probe ${labelOf(item)}: ${verdict.kind} ${verdict.ms || 0}ms${verdict.detail ? ` (${String(verdict.detail).slice(0, 80)})` : ''}`);
        return { n: chain.indexOf(item) + 1, route: labelOf(item), kind: VERDICT[verdict.kind] || 'other', ms: verdict.ms };
      });
      // One way back to the card: the probe answer is long, and the person who
      // just learned route 4 is dead wants the list, not a typed command.
      say(renderProbe({ t: tr, rows }), { keyboard: [[{ text: t(lang, 'ctrl.fallback.back'), data: 'fb:s' }]] });
      return true;
    }

    // Removing asks for a second, named press: a number is only trustworthy while
    // the card that printed it is still the card on screen.
    case 'menu':
    case 'r': {
      if (chain.length === 0) {
        say(t(lang, 'ctrl.fallback.empty'));
        return true;
      }
      say(t(lang, 'ctrl.fallback.removeTitle'), { keyboard: removeKeyboard({ t: tr, chain }) });
      return true;
    }

    case 'e':
    case 'chain': {
      config.fallbackEnabled = !enabled;
      done(config.fallbackEnabled ? 'ctrl.fallback.chainOn' : 'ctrl.fallback.chainOff');
      return true;
    }

    default:
      // A word this command does not know is a usage line, not a prompt: the
      // handler claims every `/fallback …`, so a typo never reaches the model.
      say(t(lang, 'ctrl.fallback.usage'));
      return true;
  }
}
