// The two /doctor rows that answer "is anything still watching?".
//
// The bridge cannot report its own death, and it cannot report that the minute
// supervisor stopped either: a dead supervisor looks exactly like a healthy
// idle bot until the next crash, which then becomes permanent. These rows are
// read from files on disk (the restart marker and the supervisor's log), so they
// stay honest even when the process asking is the one that was just restarted.
//
// Kept out of `cmd-bridge.mjs`, which is already close to the 500-line ceiling.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../core/i18n.mjs';

/**
 * An age short enough for a diagnostic row: `0s`, `45s`, `12m`, `5h`, `3d`.
 *
 * Deliberately unit-suffixed ASCII rather than a sentence: the row is read in
 * three languages, and "12m" survives all of them where a translated word would
 * need three more keys for no extra meaning.
 */
export function describeAge(ms) {
  const secs = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  if (secs < 90) return `${secs}s`;
  const mins = Math.round(secs / 60);
  // Rounding 50 minutes up to "1h" would overstate the age of a supervisor that
  // is merely a little behind; the unit changes only when the value does.
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The supervision rows, in the order a person would ask about them. */
export function supervisionRows(lang, dshHome) {
  const dir = join(dshHome, 'tg-bridge');
  const rows = [];

  // A marker that outlives its restart means the next start will announce an
  // interrupted turn that is not news. The kick clears it after ten minutes;
  // seeing one older than that here means the supervisor is not running.
  try {
    const marker = join(dir, 'restart.pending');
    rows.push(`${t(lang, 'ctrl.doctor.restartMarker')}: ${existsSync(marker)
      ? t(lang, 'ctrl.doctor.restartMarkerSet', { age: describeAge(Date.now() - statSync(marker).mtimeMs) })
      : t(lang, 'ctrl.doctor.restartMarkerClear')}`);
  } catch {}

  try {
    const kick = join(dir, 'kick.log');
    rows.push(`${t(lang, 'ctrl.doctor.kickAge')}: ${t(lang, 'ctrl.doctor.kickAgo', {
      age: describeAge(Date.now() - statSync(kick).mtimeMs),
    })}`);
  } catch {
    rows.push(`${t(lang, 'ctrl.doctor.kickAge')}: ${t(lang, 'ctrl.doctor.kickMissing')}`);
  }

  return rows;
}