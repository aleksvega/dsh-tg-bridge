// `/dsh` — the installed harness, the published one, and what this bridge was
// tested against. A table of its own because `ctrl.mjs` is at its line ceiling,
// not because the keys belong to a different subject.
export default {
  'ctrl.dsh.noInstalled': 'I could not read `dsh --version` — the harness may not be installed where the bridge looks for it. /doctor says which binary a turn would start.',
  'ctrl.dsh.head': '🔧 DSH {installed} · latest {latest}',
  'ctrl.dsh.headUnknown': '🔧 DSH {installed} · npm did not say which is latest',
  'ctrl.dsh.tested': 'Tested with this bridge: {range}',
  'ctrl.dsh.untested': 'Outside the range this bridge was tested with: {range}. It may still work — /doctor says what is known.',
  'ctrl.dsh.hint': 'Update: /dsh update',
  'ctrl.dsh.noLatest': 'npm did not answer, so there is nothing to install. Try again in a minute.',
  'ctrl.dsh.plan': 'This will run:\n{cmd}\nIt replaces DSH for every profile. Send /dsh update confirm to go ahead.',
  'ctrl.dsh.done': 'Installed {version}. The bridge still runs on the old one: restart DSH and it comes up on the new version.',
  'ctrl.dsh.error': 'Install failed: {error}',
  'ctrl.dsh.usage': 'I understand /dsh, /dsh update and /dsh update confirm.',
  'ctrl.dsh.button': 'Update to {latest}',
  'ctrl.dsh.confirmButton': 'Install it',
  'ctrl.doctor.dsh': 'DSH',
  'ctrl.doctor.dshTested': '{version} (tested)',
  'ctrl.doctor.dshUntested': '{version} (outside the tested range)',
  'ctrl.help.about.dsh': 'Which DSH is installed, which one npm publishes, and whether this bridge was tested on it. /dsh update installs the published one; the restart is yours to do.',
};
