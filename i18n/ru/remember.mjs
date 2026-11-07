// RU strings for long-term memory (/remember).
//
// A table of its own for the same reason `branch.mjs` is: one feature, one
// file, one diff, and `ctrl.mjs` stays off the 500-line ceiling.
export default {
  'ctrl.help.about.remember': "Долгая память: /remember <факт> дописывает датированную строку в секцию Learned файла AGENTS.md — то, что агент читает перед каждым ходом. /remember показывает секцию, /remember tidy запускает ход, который сам чистит устаревшее, /remember forget <слово> или forget all — стирает. Память, которую видно всю.",
  'ctrl.remember.saved': "Запомнил (строк в памяти: {count}).",
  'ctrl.remember.dropped': "Запомнил (строк: {count}) — память полна, вытеснил {dropped} самых старых. /remember tidy сожмёт список.",
  'ctrl.remember.list': "Память — {n} строк(и), последние:\n{list}",
  'ctrl.remember.empty': "Память пуста. /remember <факт> — и строка с датой уйдёт в AGENTS.md, туда, куда агент смотрит перед каждым ходом.",
  'ctrl.remember.tidy': "Запустил ход: агент перечитает свою память, сольёт дубли и выкинет устаревшее. Отчёт придёт сообщением.",
  'ctrl.remember.task': "Наведи порядок в своей памяти. Открой файл AGENTS.md в DSH_HOME, найди секцию «## Learned (DSH memory)»: перечитай все строки, слей дубли и повторяющееся, вычеркни то, что устарело или никогда не пригодится, даты сохрани. Секцию держи не длиннее 60 строк, чужие секции файла не трогай. Файл правь инструментами записи, а потом ответь одним списком: что удалил, что оставил и почему.",
  'ctrl.remember.forgot': "Стёр {n} строк(у), осталось {count}.",
  'ctrl.remember.forgotAll': "Секция памяти очищена — весь файл, кроме неё, цел.",
  'ctrl.remember.notFound': "«{word}» в памяти не нашлось — ничего не стёр.",
  'ctrl.remember.noTurn': "Здесь нельзя запустить ход из команды — память почисть руками через /edit.",
};
