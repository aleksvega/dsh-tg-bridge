// The `/model` picker: every route a profile can run, as buttons.
//
// Its own table because the card is a screen of its own — the settings card and
// the command list each have one, and a picker that answers "where do the
// answers come from" belongs with them rather than in the middle of the
// control strings.
export default {
  'ctrl.model.pickTitle': '🎛 Маршруты профиля {profile}',
  'ctrl.model.pickNow': 'Сейчас: {route}',
  'ctrl.model.pickNowTopic': 'Эта тема: {route}',
  'ctrl.model.pickNowDefault': 'По умолчанию в профиле: {route} — для остальных тем',
  'ctrl.model.pickFollow': '↩ Снова как в профиле',
  'ctrl.model.topicSet': 'Эта тема теперь отвечает на {route}. Остальные темы — {default}.',
  'ctrl.model.topicCleared': 'Эта тема снова как в профиле: {route}.',
  'ctrl.model.topicNone': 'У этой темы своего маршрута не было, она и так как в профиле: {route}.',
  'ctrl.model.topicKept': 'Свой маршрут сохранили тем: {n}.',
  'ctrl.model.pickUnknown': 'Сейчас: в профиле {profile} нет строки модели по умолчанию',
  'ctrl.model.pickGroup': '— {provider} —',
  'ctrl.model.pickHint': 'Нажми маршрут, чтобы переключиться. Провайдер и модель меняются вместе: одно и то же имя модели могут отдавать разные эндпоинты.',
  'ctrl.model.pickRefresh': '↻ Обновить',
  'ctrl.model.pickHidden': 'Ещё {n} маршрут(ов) не влезли; любой из них можно назвать как /model <провайдер>/<модель>.',
  'ctrl.model.pickLong': 'У всех маршрутов профиля {profile} имя не влезает в кнопку; переключиться всё равно можно: /model <провайдер>/<модель>.',
  'ctrl.model.pickNone': 'В профиле {profile} нет моделей на выбор.',
  'ctrl.model.pickSwitched': 'Маршрут {name} → {route}. Действует со следующего хода.',
  'ctrl.model.pickStale': 'В профиле {name} больше нет маршрута {route} — профиль изменился после того, как карточка была нарисована. /model — покажу, что есть сейчас.',
  'ctrl.model.scopeAllOn': '🌍 Меняю везде ▸ нажми, чтобы только эту тему',
  'ctrl.model.scopeTopicOn': '💬 Меняю эту тему ▸ нажми, чтобы везде',
  'ctrl.model.scopeAllHead': 'Режим «везде»: по умолчанию в профиле сейчас {route}. Нажатие на маршрут переведёт на него все темы, у которых нет своего.',
  'ctrl.model.scopeAllHint': 'Выбери маршрут — он станет общим для всего профиля. Темы со своим маршрутом останутся на своём: переключить их можно по одной в режиме «эта тема».',
  'ctrl.model.scopeAllSet': 'Теперь нажатие меняет маршрут всего профиля.',
  'ctrl.model.scopeTopicSet': 'Теперь нажатие меняет маршрут только этой темы.',
};