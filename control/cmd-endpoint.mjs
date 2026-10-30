// `/endpoint` — the provider list, read and edited from the chat.
//
// Adding an endpoint is four facts typed once. Sending them through an AI turn
// would mean a slow answer, a paraphrase of a URL that has to be exact, and a
// token spent on what a text edit does — so the command parses and writes the
// patch itself, and says in the chat what it changed.
import { t } from '../i18n.mjs';
import { endpointRows, parseEndpointArgs, applyEndpoint } from './endpoint.mjs';
import { routesOf, modelOf } from './models.mjs';

/** Why a line was refused, in words a person can act on. */
function whyText(lang, why, parsed) {
  const key = `ctrl.endpoint.why.${String(why).replace('.', '_')}`;
  const vars = {
    id: parsed?.id || '',
    model: parsed?.model || '',
    form: t(lang, 'ctrl.endpoint.addForm'),
  };
  // An unknown reason must not print a key at the person: the generic line still
  // says what to type, which is the only thing the answer is for.
  const text = t(lang, key, vars);
  return text.startsWith('ctrl.endpoint.') ? t(lang, 'ctrl.endpoint.why.usage', vars) : text;
}

function listText(lang, profile) {
  const rows = endpointRows(profile);
  const current = modelOf(profile);
  if (rows.length === 0) return t(lang, 'ctrl.endpoint.empty', { profile });
  const lines = [t(lang, 'ctrl.endpoint.listHead', { profile, n: rows.length }), ''];
  for (const row of rows) {
    const live = row.id === current.provider ? t(lang, 'ctrl.endpoint.inUse') : '';
    lines.push(`${live}${row.id} · ${row.models.length} ${t(lang, 'ctrl.endpoint.models')}`);
    lines.push(`  ${row.baseURL || t(lang, 'ctrl.endpoint.noUrl')}${row.keyEnv ? ` · ${row.keyEnv}` : ''}`);
  }
  lines.push('', t(lang, 'ctrl.endpoint.listHint'));
  return lines.join('\n');
}

export async function handleEndpointCommands(ctx) {
  const { effective, arg, lang, reply, log, profile, config } = ctx;
  if (effective !== '/endpoint') return false;
  const activeProfile = profile || config?.profile || 'headless';
  const parsed = parseEndpointArgs(arg);
  if (!parsed.ok) {
    await reply(whyText(lang, parsed.why, parsed));
    return true;
  }
  if (parsed.verb === 'list') {
    await reply(listText(lang, activeProfile));
    return true;
  }
  const result = applyEndpoint(activeProfile, parsed);
  if (!result.ok) {
    // `unchanged` is not a failure: the person re-typed what was already there,
    // and saying so is more useful than reporting an error on a no-op.
    await reply(parsed.verb === 'add' && result.why === 'unchanged'
      ? t(lang, 'ctrl.endpoint.unchanged', { id: parsed.id })
      : whyText(lang, result.why, parsed));
    return true;
  }
  log(`endpoint ${parsed.verb} ${result.id} in ${activeProfile}`);
  if (parsed.verb === 'rm') {
    await reply(t(lang, 'ctrl.endpoint.removed', { id: result.id, profile: activeProfile }));
    return true;
  }
  const added = result.modelsAdded?.length || 0;
  if (added === 0) {
    await reply(t(lang, result.added ? 'ctrl.endpoint.addedNoModels' : 'ctrl.endpoint.updatedNoModels', {
      id: result.id,
      profile: activeProfile,
    }));
  } else {
    await reply(
      t(lang, result.added ? 'ctrl.endpoint.added' : 'ctrl.endpoint.updated', {
        id: result.id,
        profile: activeProfile,
        n: added,
        models: result.modelsAdded.join(', '),
      }),
    );
  }
  // A new route is a new button on the `/model` card, so the next line points at
  // it instead of leaving the person to discover it on their own.
  const routes = routesOf(activeProfile).filter((route) => route.provider === result.id);
  if (routes.length > 0) {
    await reply(t(lang, 'ctrl.endpoint.nowPick', { n: routes.length, id: result.id }));
  }
  return true;
}