// The load card: how busy this computer is, and the limits that keep it usable.
//
// Rendered apart from the command for the same reason as the other cards — a
// formatter that lives beside the state changes grows a second copy of itself.
import { breaches } from './machine.mjs';

export const LOAD_PREFIX = 'ld:';

/** `ld:r` → `'r'`; anything else is null, never a throw. */
export function loadPress(data) {
  const text = String(data || '');
  if (!text.startsWith(LOAD_PREFIX)) return null;
  return text.slice(LOAD_PREFIX.length) || null;
}

/** A bar that reads at a glance on a phone: ten cells, no colour codes. */
export function bar(pct) {
  if (!Number.isFinite(pct)) return '';
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

/**
 * The card.
 *
 * `turns` and `queued` are the bridge's own share of the load: Task Manager
 * shows Electron children, not which one is a Telegram topic, so the row that
 * says "2 of 3 slots busy" is the only place that question is answered.
 */
export function renderLoadCard({ t, sample, guard, turns = 0, queued = 0, max = 3 }) {
  const over = breaches(sample, guard);
  const ramPct = sample.ram.totalGb > 0 ? Math.round(((sample.ram.totalGb - sample.ram.freeGb) / sample.ram.totalGb) * 100) : 0;
  const usedDiskPct = sample.disk.totalGb > 0 ? Math.round(((sample.disk.totalGb - sample.disk.freeGb) / sample.disk.totalGb) * 100) : 0;
  const mark = (key) => (over.some((one) => one.key === key) ? ' ⚠️' : '');
  const lines = [
    t('ctrl.load.title', { host: sample.host }),
    '',
    `${t('ctrl.load.cpu')} ${sample.cpuPct}%${mark('cpu')} ${bar(sample.cpuPct)}`,
    `${t('ctrl.load.ram')} ${t('ctrl.load.ramValue', { free: sample.ram.freeGb, total: sample.ram.totalGb, pct: ramPct })}${mark('ram')}`,
    sample.disk.freeGb === null
      ? `${t('ctrl.load.disk', { drive: sample.disk.drive.replace(/\\$/, '') })} ${t('ctrl.load.unknown')}`
      : `${t('ctrl.load.disk', { drive: sample.disk.drive.replace(/\\$/, '') })} ${t('ctrl.load.diskValue', { free: sample.disk.freeGb, total: sample.disk.totalGb, pct: usedDiskPct })}${mark('disk')}`,
    '',
    t('ctrl.load.bridge', { turns, max, queued }),
    t('ctrl.load.uptime', { hours: sample.uptimeH, cores: sample.cores }),
    '',
    guard.enabled ? t('ctrl.load.guardOn') : t('ctrl.load.guardOff'),
    guard.enabled
      ? t('ctrl.load.limits', { cpu: guard.cpuPct, ram: guard.ramFreePct, disk: guard.diskFreeGb })
      : t('ctrl.load.limitsOff'),
  ];
  if (over.length) {
    lines.push('', t('ctrl.load.over', {
      what: over.map((one) => t(`ctrl.load.what.${one.key}`, { value: one.value, limit: one.limit })).join('; '),
    }));
  }
  lines.push('', t('ctrl.load.usage'));
  return { text: lines.join('\n'), keyboard: loadKeyboard({ t, guard }) };
}

export function loadKeyboard({ t, guard }) {
  return [
    [
      { text: t('ctrl.load.refresh'), data: `${LOAD_PREFIX}r` },
      { text: guard.enabled ? t('ctrl.load.turnOff') : t('ctrl.load.turnOn'), data: `${LOAD_PREFIX}g` },
    ],
  ];
}
