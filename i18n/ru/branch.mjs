// RU strings for branching between topics.
//
// A table of its own for the reason this directory already splits tables: one
// feature, one file, one diff. It also keeps `ctrl.mjs` under the 500-line
// ceiling, which that table was sitting on.
export default {
  'ctrl.help.about.branch': "Ветка в другую тему — две формы. /branch <id> приносит копию той сессии сюда: эта тема продолжит её, исходная остаётся цела. /branch new уносит копию этой сессии в новую тему и оставляет эту как была. Копия внутри этой темы — /rewind fork. Ветка — снимок разговора: дальше обе живут сами.",
  'ctrl.branch.usage': "Ветка — две формы. /branch <id> — копия той сессии сюда, эта тема продолжит её. /branch new — копия этой сессии в новую тему. Копия внутри этой темы — /rewind fork.",
  'ctrl.branch.hereDone': "Ветка создана: тема продолжает {id}, сохранено {kept} ход(ов). Исходная сессия цела.",
  'ctrl.branch.topicDone': "Открыл тему «{name}» — там копия этой сессии ({id}), {kept} ход(ов). Эта тема не тронута.",
  'ctrl.branch.topicFailed': "Тему открыть не вышло — нет прав на темы или лимит Telegram. Копию убрал, ничего не изменилось.",
  'ctrl.branch.unsupported': "Эта сборка не умеет открывать темы: ветка в новую тему недоступна.",
  'ctrl.branch.seed': "Ветка от темы «{name}»: копия сессии, {kept} ход(ов). Работай здесь — исходная тема не тронута.",
  'ctrl.branch.suffix': "ветка",
  'ctrl.branch.untitled': "Без названия",
};
