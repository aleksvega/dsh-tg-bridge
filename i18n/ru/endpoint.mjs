// `/endpoint`: the provider list, and adding one from the chat.
//
// A file of its own so the command's words live together: what the list shows,
// what a refusal says, and what a success promises — the promise is "a new
// button on /model", which is the reason a person added the endpoint at all.
export default {
  'ctrl.endpoint.listHead': '🔌 Эндпоинты {profile} ({n})',
  'ctrl.endpoint.empty': 'В профиле {profile} нет эндпоинтов. Добавь: /endpoint add <id> <https://url/v1> <KEY_ENV> [модель,модель]',
  'ctrl.endpoint.models': 'модел.',
  'ctrl.endpoint.noUrl': 'нет baseURL',
  'ctrl.endpoint.inUse': '✓ ',
  'ctrl.endpoint.listHint': 'Добавить или заменить:\n`/endpoint add <id> <https://url/v1> <KEY_ENV> [модель,модель]`\nУдалить:\n`/endpoint rm <id>`\nСам ключ сюда не пишется — только имя переменной окружения, где он лежит.',
  'ctrl.endpoint.addForm': 'id — строчные латинские буквы, цифры и дефис. baseURL только https (http — лишь для localhost). KEY_ENV — имя переменной с ключом, например MYROUTER_API_KEY. Модели необязательны, через запятую.',
  'ctrl.endpoint.added': 'Эндпоинт {id} добавлен в {profile}; моделей: {n} ({models}). Уже следующий ход может им пользоваться, а /model покажет его маршруты.',
  'ctrl.endpoint.updated': 'Эндпоинт {id} обновлён в {profile}. Добавлено моделей: {n} ({models}).',
  'ctrl.endpoint.removed': 'Эндпоинт {id} удалён из {profile}.',
  'ctrl.endpoint.unchanged': 'У эндпоинта {id} ровно это и было — менять нечего.',
  'ctrl.endpoint.addedNoModels': 'Эндпоинт {id} добавлен в {profile}, моделей пока нет. Назови их, когда будешь знать: /endpoint add {id} <https://url/v1> <KEY_ENV> модель1,модель2',
  'ctrl.endpoint.updatedNoModels': 'Эндпоинт {id} обновлён в {profile}; новых моделей нет.',
  'ctrl.endpoint.nowPick': '/model нарисует {n} маршрут(ов) {id} кнопками.',
  'ctrl.endpoint.why.usage': 'Как пользоваться:\n`/endpoint list`\n`/endpoint add <id> <https://url/v1> <KEY_ENV> [модель,модель]`\n`/endpoint rm <id>`\n{form}',
  'ctrl.endpoint.why.badId': '{id} не годится как id: строчные латинские буквы, цифры и дефис, начинается с буквы, до 31 символа.',
  'ctrl.endpoint.why.url_insecure': 'Это не https. Эндпоинт везёт API-ключ в каждом запросе, и по открытому http он бы утёк — http разрешён только для localhost.',
  'ctrl.endpoint.why.url_notUrl': 'Это не похоже на URL. Нужны схема и хост, например `https://api.example.com/v1`.',
  'ctrl.endpoint.why.url_empty': 'Не хватает base URL.',
  'ctrl.endpoint.why.key_empty': 'Не хватает имени переменной с ключом.',
  'ctrl.endpoint.why.key_notName': 'Похоже на сам ключ, а нужно имя. Напиши имя переменной (`MYROUTER_API_KEY`) — ключ живёт в окружении, не в переписке.',
  'ctrl.endpoint.why.badModel': '{model} не годится как id модели: буквы, цифры, точки, дефисы, подчёркивания и двоеточия.',
  'ctrl.endpoint.why.missing': 'В профиле {profile} нет эндпоинта с таким id. Что есть — покажет `/endpoint list`.',
  'ctrl.endpoint.why.noProviders': 'В этом профиле нет блока `providers:` — он не задаёт эндпоинты, и править тут нечего.',
  'ctrl.help.about.endpoint': "Эндпоинты, до которых дотягивается этот профиль, и добавление своего без хода модели: /endpoint list, /endpoint add <id> <https://url/v1> <KEY_ENV> [модель,модель], /endpoint rm <id>. Вводится только имя переменной с ключом — сам ключ живёт в окружении. Новая модель сразу появляется в /model кнопкой.",
};