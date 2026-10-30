import test from 'node:test';
import assert from 'node:assert/strict';
import { immediateKind } from '../turn/immediate.mjs';
import { CONTROL_COMMANDS } from '../chat/control.mjs';

test('reports answer while a turn is working', () => {
  for (const name of [
    'status', 'logs', 'help', 'doctor', 'models', 'model', 'profile', 'sessions',
    'skills', 'prices', 'thoughts', 'goal', 'task', 'reasoning', 'lang', 'soul',
    'cd', 'app',
  ]) {
    assert.equal(immediateKind(name, []), name, name);
  }
  assert.equal(immediateKind('sessions', ['5']), 'sessions');
  assert.equal(immediateKind('skills', ['context-compaction']), 'skills');
});

test('every menu command is either immediate or deliberately queued', () => {
  const queued = new Set(['new', 'resume', 'seed', 'send']);
  for (const name of CONTROL_COMMANDS) {
    if (queued.has(name)) {
      assert.equal(immediateKind(name, ['x']), '', name);
    } else {
      assert.notEqual(immediateKind(name, []), '', name);
    }
  }
});

test('plugin listing is immediate, plugin changes queue', () => {
  assert.equal(immediateKind('plugins', []), 'plugins');
  assert.equal(immediateKind('plugins', ['headless']), 'plugins');
  for (const action of ['add', 'remove', 'disable', 'enable']) {
    assert.equal(immediateKind('plugins', [action, 'x']), '', action);
  }
  assert.equal(immediateKind('plugin', ['add', 'x']), '');
});

test('settings that only affect the next turn answer at once', () => {
  assert.equal(immediateKind('soul', ['ты', 'пират']), 'soul');
  assert.equal(immediateKind('lang', ['en']), 'lang');
  assert.equal(immediateKind('model', ['glm-5.3']), 'model');
});

test('turn control stays immediate', () => {
  assert.equal(immediateKind('stop', []), 'stop');
  assert.equal(immediateKind('restart', ['confirm']), 'restart');
  assert.equal(immediateKind('restartconfirm', []), 'restart');
  assert.equal(immediateKind('apprestart', []), 'restart');
  assert.equal(immediateKind('apprestartconfirm', []), 'restart');
});

test('commands that feed the running session queue', () => {
  for (const name of ['new', 'resume', 'seed', 'send']) {
    assert.equal(immediateKind(name, ['x']), '', name);
  }
  assert.equal(immediateKind('cd', ['C:\\tmp']), 'cd');
});

test('an unknown command still answers instead of vanishing into the queue', () => {
  assert.equal(immediateKind('nonsense', []), 'nonsense');
});
