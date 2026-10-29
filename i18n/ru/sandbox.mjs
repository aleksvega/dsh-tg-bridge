// A sandbox refusal is a decision, not a crash — and these are the words that
// say so. Their own table because the distinction between "the policy said no"
// and "the sandbox itself broke" is the whole point of the feature, and a
// reader of `ctrl.mjs` should not have to hold both meanings in mind.
export default {
  'sandbox.times': 'За этот ход так {n} раз(а).',
  'sandbox.denied': '🔒 Песочница отказала: при режиме «{mode}» запись не разрешена. Это политика делает свою работу, а не поломка — ход остановился там, где ему велели.',
  'sandbox.runner': '🔒 Сломалась сама песочница в режиме «{mode}», команда не запускалась. Это проблема песочницы, а не задачи — /doctor скажет, доступен ли запускатель на этой машине.',
  'sandbox.open': '🔐 Изменить права',
};
