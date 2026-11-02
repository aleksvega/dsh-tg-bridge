// Строки `/doctor`, отвечающие на вопрос «за процессом ещё кто-то смотрит?».
//
// Отдельная таблица, потому что `ctrl.mjs` стоит у потолка в 500 строк, а эти
// шесть ключей — одна группа строк: метка рестарта и возраст последнего тика
// супервизора. Возраст считается в коде и здесь только подставляется.
export default {
  'ctrl.doctor.restartMarker': 'Метка рестарта',
  'ctrl.doctor.restartMarkerSet': 'висит {age}',
  'ctrl.doctor.restartMarkerClear': 'нет',
  'ctrl.doctor.kickAge': 'Супервизор',
  'ctrl.doctor.kickAgo': 'последний тик {age} назад',
  'ctrl.doctor.kickMissing': 'тиков ещё не было',
};