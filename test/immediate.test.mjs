import test from 'node:test';
import assert from 'node:assert/strict';
import { immediateKind } from '../immediate.mjs';

test('read-only reports run while a turn is working', () => {
  for (const name of ['status', 'logs', 'help', 'doctor', 'models', 'sessions', 'skills', 'prices']) {
    assert.equal(immediateKind(name, []), name, name);
  }
  assert.equal(immediateKind('models', []), 'models');
  assert.equal(immediateKind('sessions', ['5']), 'sessions');
  assert.equal(immediateKind('skills', ['context-compaction']), 'skills');
});

test('plugin listing is immediate, plugin changes are not', () => {
  assert.equal(immediateKind('plugins', []), 'plugins');
  assert.equal(immediateKind('plugins', ['headless']), 'plugins');
  for (const action of ['add', 'remove', 'disable', 'enable']) {
    assert.equal(immediateKind('plugins', [action, 'x']), '', action);
  }
  assert.equal(immediateKind('plugin', ['add', 'x']), '');
});

test('bare reports are immediate, their mutating forms queue', () => {
  assert.equal(immediateKind('soul', []), 'soul');
  assert.equal(immediateKind('soul', ['ты', 'пират']), '');
  assert.equal(immediateKind('lang', []), 'lang');
  assert.equal(immediateKind('lang', ['en']), '');
});

test('turn control stays immediate', () => {
  assert.equal(immediateKind('stop', []), 'stop');
  assert.equal(immediateKind('restart', ['confirm']), 'restart');
  assert.equal(immediateKind('restartconfirm', []), 'restart');
  assert.equal(immediateKind('apprestart', []), 'restart');
});

test('state-changing commands queue', () => {
  for (const name of ['model', 'new', 'resume', 'cd', 'send', 'seed', 'seedTopic']) {
    assert.equal(immediateKind(name, ['x']), '', name);
  }
});
