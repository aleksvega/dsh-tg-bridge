// Per-topic instruction files and skill directories.
//
// The mechanism is DSH's own chain: the harness loads every candidate file it
// finds from the project root down to the turn's directory, so a topic's rules
// are just another candidate name in that chain. What these tests pin down is
// the part the bridge owns — that the profile a set materialises names the
// file, that the project's own candidates survive the edit, and that a name
// which can never match is refused instead of written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setInstructionFiles, setSkillDirs } from '../profile/patch-rows.mjs';
import { derivedName, overlayPatch } from '../profile/aset-profile.mjs';
import { ensureInstructionFile, instructionName } from '../profile/topic-docs.mjs';

const BASE = [
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    model: glm-5.3',
  '',
].join('\n');

test('a topic file is added to the chain, not swapped in for the project one', () => {
  const next = setInstructionFiles(BASE, ['AGENTS.game.md']);
  assert.match(next, /agent-instructions/, 'the row was not written');
  assert.match(next, /- AGENTS\.md/, 'the project candidate was dropped');
  assert.match(next, /- AGENTS\.game\.md/, 'the topic candidate is missing');
  // The plugin requires a budget; a row without one fails to compose.
  assert.match(next, /maxBytes: 65536/);
});

test('a candidate the base already declares survives the edit', () => {
  const withTeam = [
    '- id: agent-instructions',
    '  name: "@deepseek-ai/dsh-agent-instructions"',
    '  config:',
    '    maxBytes: 65536',
    '    instructionFileCandidates:',
    '      - AGENTS.md',
    '      - TEAM.md',
    '',
  ].join('\n');
  const next = setInstructionFiles(withTeam, ['AGENTS.game.md']);
  assert.match(next, /- TEAM\.md/, 'a hand-written candidate was replaced');
  assert.match(next, /- AGENTS\.game\.md/);
  assert.equal((next.match(/maxBytes:/g) || []).length, 1, 'the row was duplicated');
});

test('skill directories are additive and keep the install roots', () => {
  const next = setSkillDirs(BASE, ['/home/u/topic-skills']);
  assert.match(next, /skill-filesystem/);
  assert.match(next, /includeDefaultRoots: true/, 'the default roots were switched off');
  assert.match(next, /- \/home\/u\/topic-skills/);
});

test('a set that only names docs still gets a profile of its own', () => {
  // The name carries a hash of the inputs: without the new fields an edited set
  // lands in the directory it did not change, materialise returns early on the
  // existing patch, and the edit is never loaded.
  const plain = derivedName('headless', { id: 'game', name: 'game' }, '');
  const withDocs = derivedName('headless', { id: 'game', name: 'game', instructions: ['AGENTS.game.md'] }, '');
  const withSkills = derivedName('headless', { id: 'game', name: 'game', skillDirs: ['/tmp/sk'] }, '');
  assert.notEqual(plain, withDocs);
  assert.notEqual(withDocs, withSkills);
});

test('docs alone count as a reason to build a profile', () => {
  const { patch, changed } = overlayPatch(BASE, { instructions: ['AGENTS.game.md'] });
  assert.equal(changed, true, 'the overlay reported nothing to write');
  assert.match(patch, /AGENTS\.game\.md/);
});

test('a set that names no docs leaves the profile alone', () => {
  const { patch, changed } = overlayPatch(BASE, { instructions: [], skillDirs: [] });
  assert.equal(changed, false);
  assert.equal(patch, BASE);
});

test('a path is not a candidate name', () => {
  // A candidate is matched per directory, so `docs/AGENTS.md` never matches and
  // the rule would read as applied while the model never sees it.
  assert.equal(instructionName('docs/AGENTS.md'), '');
  assert.equal(instructionName('AGENTS.game.md'), 'AGENTS.game.md');
  assert.equal(instructionName('rules.txt'), '');
});

test('naming a missing file creates it, and only once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-topic-docs-'));
  try {
    const first = ensureInstructionFile('AGENTS.game.md', dir);
    assert.equal(first.created, true);
    assert.ok(existsSync(first.file));
    assert.match(readFileSync(first.file, 'utf8'), /# AGENTS\.game\.md/);
    const second = ensureInstructionFile('AGENTS.game.md', dir);
    assert.equal(second.created, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
