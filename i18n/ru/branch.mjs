// RU strings for branching between topics.
//
// A table of its own for the reason this directory already splits tables: one
// feature, one file, one diff. It also keeps `ctrl.mjs` under the 500-line
// ceiling, which that table was sitting on.
export default {
  'ctrl.help.about.branch': "Ветка в другую тему — две формы. /branch <id> приносит копию той сессии сюда: эта тема продолжит её, исходная остаётся цела. /branch new [n] уносит копию этой сессии в новую тему — целиком или от n ходов назад. Кнопки 🌿 в карточке /rewind предлагают то же для последних ходов. Копия внутри этой темы — /rewind fork. Ветка — снимок разговора: дальше обе живут сами.",
  'ctrl.branch.usage': "Ветка — две формы. /branch <id> — копия той сессии сюда, эта тема продолжит её. /branch new [n] — копия этой сессии в новую тему, от n ходов назад (без числа — целиком). Копия внутри этой темы — /rewind fork.",
  'ctrl.branch.working': "Копирую сессию…",
  'ctrl.branch.confirm': "Ветка от хода {turn}: в копии первые {kept} ход(ов), исходная сессия останется целой. Куда унести копию?",
  'ctrl.branch.here': "В эту тему",
  'ctrl.branch.new': "В новую тему",
  'ctrl.branch.hereDone': "Ветка создана: тема продолжает {id}, сохранено {kept} ход(ов). Исходная сессия цела.",
  'ctrl.branch.topicDone': "Открыл тему «{name}» — там копия этой сессии ({id}), {kept} ход(ов). Эта тема не тронута.",
  'ctrl.branch.topicFailed': "Тему открыть не вышло — нет прав на темы или лимит Telegram. Копию убрал, ничего не изменилось.",
  'ctrl.branch.unsupported': "Эта сборка не умеет открывать темы: ветка в новую тему недоступна.",
  'ctrl.branch.seed': "Ветка от темы «{name}»: копия сессии, {kept} ход(ов). Работай здесь — исходная тема не тронута.",
  'ctrl.branch.suffix': "ветка",
  'ctrl.branch.untitled': "Без названия",
  // The fork family moved here from ctrl.mjs: a fork is a branch that stays in
  // this topic, and the ctrl table was at the 500-line ceiling.
  'ctrl.fork.done': "Ветка создана: тема продолжается в {id}, сохранено {kept} ход(ов). Старая сессия цела — обе видны в /rewind branches.",
  'ctrl.fork.noSession': "В этой теме ещё нет сессии: её начнёт первое сообщение.",
  'ctrl.fork.busy': "В теме идёт ход. Он пишет свою сессию — ветвить надо после него.",
  'ctrl.fork.usage': "Как это работает: /rewind fork — копия отсюда, /rewind fork 2 — копия с двух ходов назад.",
  'ctrl.fork.working': "Копирую сессию…",
  'ctrl.fork.failed': "Ветку создать не удалось: {error}",
  'ctrl.fork.none': "В этой теме ещё нет веток. Создать: /rewind fork.",
  'ctrl.fork.list': "Ветки этой темы: {n}",
  'ctrl.fork.current': "Тема сейчас на {id}.",
  'ctrl.fork.turns': "{n} ход(ов)",
};
