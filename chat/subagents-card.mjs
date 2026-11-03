// The subagents panel: the desktop app's session view, as far as a headless
// turn can honestly fill it.
//
// One line per run — the task it was given and how long it took — then the
// totals, then the one sentence that keeps the card from lying: the host reports
// no tokens per subagent, so the card does not print a share of the turn's.
//
// No buttons. A refresh would redraw the same rows from the same state, and a
// control that cannot change what it shows is the dead switch this repo keeps
// removing.
import { t } from '../core/i18n.mjs';
import { runsSummary } from '../work/subagents.mjs';

/** 74000 → `1m 14s`. Minutes and seconds only: a subagent that runs for hours is a bug. */
export function span(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '';
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** A task as one line: long enough to recognise, short enough to scan. */
function label(run, lang) {
  const text = String(run?.label || '').replace(/\s+/g, ' ').trim();
  if (!text) return t(lang, 'ctrl.sa.unnamed');
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** The card for one topic's runs. */
export function subagentsCard(lang, runs) {
  const list = Array.isArray(runs) ? runs : [];
  const sum = runsSummary(list);
  if (!list.length) return { text: `${t(lang, 'ctrl.sa.empty')}\n\n${t(lang, 'ctrl.sa.emptyHint')}` };
  const rows = list.map((run, at) => {
    const took = Number.isFinite(run?.ms) ? span(run.ms) : t(lang, 'ctrl.sa.unfinished');
    return `${at + 1}. ${label(run, lang)} · ${took}${run?.failed ? ' ✖' : ''}`;
  });
  return {
    text: [
      t(lang, 'ctrl.sa.title', { n: sum.count }),
      '',
      ...rows,
      '',
      [t(lang, 'ctrl.sa.total', { ms: span(sum.ms) }), sum.failed ? t(lang, 'ctrl.sa.failedN', { n: sum.failed }) : ''].filter(Boolean).join(' · '),
      t(lang, 'ctrl.sa.note'),
    ].join('\n'),
  };
}
