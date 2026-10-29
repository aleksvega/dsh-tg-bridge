// `/soul` edits one section of a file the person wrote by hand.
//
// `~/.dsh/AGENTS.md` is the global instructions file: the person's own rules,
// often written over months, and the bridge is only a guest in it. The old
// implementation replaced everything from the persona heading to the end of the
// file, so a second section below the persona — or a second persona heading —
// was silently deleted by a `/soul` call, with no backup and no warning.
//
// These tests read and write real files, because the bug was in the slicing of
// real text, not in an abstraction over it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The module resolves AGENTS from DSH_HOME at import time, so the home has to be
// in place before the import — the same trick `sandbox-home.mjs` uses.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'soul-home-'));
const { AGENTS, PERSONA_HEADING, setSoul, soulOf } = await import('../control/agents.mjs');

test('writing a persona into an empty file creates it', () => {
  writeFileSync(AGENTS, '', 'utf8');
  setSoul('Be brief.');
  const text = readFileSync(AGENTS, 'utf8');
  assert.match(text, /## Persona \(DSH soul\)/);
  assert.match(text, /Be brief\./);
  assert.equal(soulOf(), 'Be brief.');
});

test('the rest of the file survives an edit of the persona', () => {
  // The exact loss the old code caused: everything after the persona heading.
  writeFileSync(AGENTS, [
    '# My rules',
    '',
    'Always answer in Russian.',
    '',
    PERSONA_HEADING,
    '',
    'Old persona.',
    '',
    '## Skill lifecycle',
    '',
    'Run the skill check before a task.',
    '',
  ].join('\n'), 'utf8');

  setSoul('New persona.');
  const text = readFileSync(AGENTS, 'utf8');
  assert.match(text, /Always answer in Russian\./, 'text above the persona was lost');
  assert.match(text, /## Skill lifecycle/, 'text below the persona was lost');
  assert.match(text, /Run the skill check before a task\./, 'a section after the persona was lost');
  assert.match(text, /New persona\./);
  assert.doesNotMatch(text, /Old persona\./, 'the old persona should have been replaced');
  assert.equal(soulOf(), 'New persona.\n\n## Skill lifecycle\n\nRun the skill check before a task.');
});

test('a persona written into a file with no persona section appends', () => {
  writeFileSync(AGENTS, '# My rules\n\nAlways answer in Russian.\n', 'utf8');
  setSoul('Be brief.');
  const text = readFileSync(AGENTS, 'utf8');
  assert.match(text, /Always answer in Russian\./);
  assert.equal(soulOf(), 'Be brief.');
});

test('the previous file is kept as a backup', () => {
  writeFileSync(AGENTS, '# Mine\n\nDo not lose this.\n', 'utf8');
  setSoul('Be brief.');
  assert.equal(existsSync(`${AGENTS}.bak`), true, 'no backup was taken');
  assert.match(readFileSync(`${AGENTS}.bak`, 'utf8'), /Do not lose this\./);
});

test('editing twice is stable, not accumulating headings', () => {
  writeFileSync(AGENTS, '# Mine\n\nKeep me.\n', 'utf8');
  setSoul('First.');
  setSoul('Second.');
  const text = readFileSync(AGENTS, 'utf8');
  assert.equal((text.match(/## Persona \(DSH soul\)/g) || []).length, 1, 'the heading was duplicated');
  assert.equal(soulOf(), 'Second.');
  assert.match(text, /Keep me\./);
});

test('a persona with markdown headings inside it does not eat the file', () => {
  // The section ends at the next top-level heading; a persona that contains one
  // is the case where "replace to the end of the file" looks almost right.
  writeFileSync(AGENTS, '# Mine\n\n## After\n\nstill here\n', 'utf8');
  setSoul('Line one.\nLine two.');
  const text = readFileSync(AGENTS, 'utf8');
  assert.match(text, /still here/);
  assert.match(text, /Line one\./);
});
