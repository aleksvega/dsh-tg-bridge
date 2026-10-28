// `/plugin add` used to write into the literal 'desktop' profile whatever the
// topic was running on and whatever the install had — on a fresh machine that
// profile does not exist, so the only in-chat install failed for a reason the
// reply never named. The help text also said "add headless or desktop at the
// end", which the parser could not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'control', 'cmd-plugin.mjs'), 'utf8');

/** The body of one `case '/name':` arm, up to the next case label. */
function arm(name) {
  const start = source.indexOf(`case '/${name}':`);
  assert.ok(start > -1, `no case for /${name}`);
  const next = source.indexOf("\n    case '/", start + 10);
  return source.slice(start, next > -1 ? next : undefined);
}

test('/plugin takes its profile from the topic, not from a constant', () => {
  const body = arm('plugin');
  assert.ok(body.includes('let target = activeProfile;'), 'the default target must be the topic profile');
  assert.ok(!/: 'desktop';/.test(body), 'no literal desktop default');
});

test('the profile word is accepted at the start or at the end', () => {
  const body = arm('plugin');
  assert.ok(body.includes('profileWord = (word)'), 'one place decides what a profile word is');
  assert.ok(body.includes('words.shift()') && body.includes('words.pop()'), 'both positions are read');
});

test('every lookup in the arm uses the resolved profile', () => {
  const body = arm('plugin');
  assert.ok(body.includes('pluginsOf(target)'), 'the installed list must be read from the same profile');
  assert.ok(!/pluginsOf\('(headless|desktop)'\)/.test(body), 'no lookup may hard-code a profile name');
});