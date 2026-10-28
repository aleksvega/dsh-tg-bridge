// A prompt written in General ("Все") starts a topic of its own.
//
// The old lobby rule moved such a message into the most recently active topic.
// The owner hit the consequence twice: text typed into "Все" landed in another
// project's conversation, and the answer appeared somewhere he was not looking.
// The rule is now: name a topic after the first words, copy the message there as
// its first message, pin it, and run the turn in that topic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { topicTitleFrom } from '../topics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'handle-message.mjs'), 'utf8');
const topics = readFileSync(join(here, '..', 'topics.mjs'), 'utf8');

test('a topic title is the first few words, not the whole prompt', () => {
  assert.equal(topicTitleFrom('починить стоимость в счёте'), 'починить стоимость в счёте');
  const long = topicTitleFrom('сделай пожалуйста так чтобы сообщения из темы все открывались в новой теме');
  assert.ok(long.length <= 40, `title was ${long.length} chars`);
  assert.ok(long.startsWith('сделай пожалуйста'), 'the title starts with the first words');
  assert.equal(topicTitleFrom('   '), '');
  assert.equal(topicTitleFrom('одно'), 'одно');
});

test('a long title never exceeds the sidebar budget', () => {
  const title = topicTitleFrom('а'.repeat(200));
  assert.ok(title.length <= 40, `title was ${title.length} chars`);
  assert.ok(title.endsWith('…'), 'a cut title must say it was cut');
});

test('General opens a topic instead of guessing the last active one', () => {
  const at = source.indexOf('if (threadId === 0 && config.generalLobby !== false)');
  assert.ok(at > 0, 'the lobby rule must still exist');
  const block = source.slice(at, at + 1200);
  assert.match(block, /startTopicFromMessage\(/, 'General must start a topic');
  assert.ok(
    block.indexOf('startTopicFromMessage(') < block.indexOf('newestBoundTopic('),
    'starting a topic must be tried before the old recovery',
  );
  assert.match(block, /looksLikeCommand|raw\.startsWith\('\/'\)/, 'a command must not spawn a topic');
});

test('the new topic starts with the person\'s own message, pinned', () => {
  assert.match(topics, /createForumTopic/);
  assert.match(topics, /copyMessage/, 'the copy keeps media and drops the forward header');
  assert.match(topics, /pinChatMessage/, 'the owner asked for the seed to be pinned');
  const at = topics.indexOf('export async function startTopicFromMessage');
  const body = topics.slice(at, at + 2000);
  assert.match(body, /seededTopics/, 'the copy must be remembered so it is not duplicated');
  assert.match(body, /noteSeed\(/, 'the duplicate guard must know about it');
});
