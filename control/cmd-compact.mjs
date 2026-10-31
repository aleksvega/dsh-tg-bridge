// `/compact` — где живёт сжатие контекста и почему здесь этой команды нет.
//
// В движке ручной компакт есть, но он команда ЧАТА приложения: через CLI та же
// строка уходит в модель обычным текстом, платит за ход и ничего не сжимает. Пока
// в чате приложения стоит `/compact`, здесь это должно быть честным ответом, а не
// «Неизвестная команда» — иначе человек узнаёт правду от модели, по счёту.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { t } from '../core/i18n.mjs';
import { DSH_HOME } from '../core/paths.mjs';
import { sessionFile, sessionStats } from '../chat/thoughts.mjs';

/**
 * Порог автокомпакта из живого патча профиля.
 *
 * Читается у этой установки, а не берётся из документации: порог живёт в
 * `cordis.patch.yml`, и установка без правки работает на дефолте движка (0.8 от
 * окна, то есть почти никогда). Назвать чужой порог — это ровно та ошибка,
 * которую карточка и должна была прекратить.
 */
export function compactionThreshold(profile, { read = (path) => readFileSync(path, 'utf8') } = {}) {
  try {
    const patch = read(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'));
    const ratio = /^\s*thresholdRatio:\s*([0-9.]+)/m.exec(patch);
    if (ratio) return { ratio: ratio[1], profile };
    // Секция есть, порога в ней нет: движок применит свой, и это другой ответ.
    return /^\s*- id:\s*compaction-basic/m.test(patch) ? { ratio: '', profile } : { ratio: null, profile };
  } catch {
    return { ratio: null, profile };
  }
}

export async function handleCompactCommands(ctx, deps = {}) {
  const { effective, lang, reply, state, key } = ctx;
  if (effective !== '/compact') return false;
  const profile = deps.profile || ctx.profile || 'headless';
  const threshold = (deps.threshold || compactionThreshold)(profile);
  const readStats = deps.stats || ((sessionId) => sessionStats(sessionFile(join(DSH_HOME, 'sessions'), sessionId)));
  const lines = [t(lang, 'ctrl.compact.head')];
  lines.push(
    threshold.ratio
      ? t(lang, 'ctrl.compact.threshold', { ratio: threshold.ratio, profile })
      : t(lang, 'ctrl.compact.noRatio', { profile }),
  );
  // Чего стоит контекст прямо сейчас: прошлый ход — единственное честное число,
  // которое у моста есть, и оно объясняет, близко ли сжатие вообще.
  const sessionId = state?.sessions?.[key] || '';
  if (!sessionId) {
    lines.push(t(lang, 'ctrl.compact.noSession'));
    await reply(lines.join('\n'));
    return true;
  }
  const stats = readStats(sessionId);
  if (stats?.contextTokens) lines.push(t(lang, 'ctrl.compact.pressure', { tokens: stats.contextTokens }));
  lines.push(t(lang, 'ctrl.compact.notACommand'));
  lines.push(t(lang, 'ctrl.compact.new'));
  await reply(lines.join('\n'), { keyboard: [[{ text: t(lang, 'ctrl.compact.button'), data: 'cp:new' }]] });
  return true;
}
