// The `/cost` card. Its own table because the numbers, their provenance and
// their three kinds of "unknown" are one subject, and `ctrl.mjs` is a list of
// one-line answers to commands rather than a place for a report.
export default {
  'ctrl.cost.head': '💰 Сколько стоил этот сеанс',
  'ctrl.cost.model': 'Модель: {route}',
  'ctrl.cost.none': 'Расхода пока нет — в этом сеансе ничего не потрачено.',
  'ctrl.cost.tokens': 'Токены: {input} вход · {output} выход · {cache} из кэша',
  'ctrl.cost.turns': 'Ходов: {n} · средний ответ {avg} токенов',
  'ctrl.cost.total': 'Итого: {sum}',
  'ctrl.cost.split': 'Вход {input} · выход {output} · кэш {cache}',
  'ctrl.cost.perTurn': 'На ход: {sum}',
  'ctrl.cost.source': 'Цены: OpenRouter на {id} — {input} вход / {output} выход за 1M, снято {when}. Это рыночный ориентир, а не счёт твоего провайдера.',
  'ctrl.cost.partial': 'У одной части счёта нет опубликованной ставки — итог снизу.',
  'ctrl.cost.noPrice': 'У OpenRouter нет цены на {route}, поэтому итога нет — только счётчики токенов выше.',
  'ctrl.cost.noCatalog': 'Кэша цен ещё нет. Повтори /cost, чтобы сходить за ним, или /prices — посмотреть список.',
};
