// docs/COMMANDS.md is the page /help links to, so it has to be the text the bot
// would give — not a page written once in a good week. The generator is the only
// author; this test fails when the committed page and the code disagree, which is
// the moment a stale list starts costing someone a wrong command.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DOC_LANGS, LANG_HEAD, commandsDoc } from '../scripts/commands-doc.mjs';
import { COMMAND_ALIASES } from '../chat/commands-registry.mjs';
import { DOC_URL, HELP_SECTIONS, commandsOf } from '../chat/help-sections.mjs';
import { LANGS, t } from '../core/i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'docs', 'COMMANDS.md');

test('docs/COMMANDS.md is what the generator would write today', () => {
  assert.equal(readFileSync(PAGE, 'utf8'), commandsDoc(), 'run: node scripts/commands-doc.mjs');
});

test('the page names every command, in every language', () => {
  const page = readFileSync(PAGE, 'utf8');
  // Each language block on its own: one complete list in three languages is the
  // point, and a section that only exists in English is a section half the
  // readers cannot use.
  const blocks = new Map();
  const marks = [...page.matchAll(/^## (\S+)$/gm)];
  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].index : page.length;
    blocks.set(mark[1], page.slice(mark.index, end));
  });
  for (const lang of LANGS) {
    const block = blocks.get(LANG_HEAD[lang]);
    assert.ok(block, `${lang}: no "${LANG_HEAD[lang]}" block on the page`);
    for (const section of HELP_SECTIONS) {
      for (const command of commandsOf(section.id)) {
        assert.ok(block.includes(`\`${command}\``), `${lang}: ${command} is missing from its block`);
      }
      assert.ok(block.includes(t(lang, `help.section.${section.id}`)), `${lang}: section ${section.id} missing`);
    }
    for (const alias of Object.keys(COMMAND_ALIASES)) {
      assert.ok(block.includes(`\`/${alias}\``), `${lang}: old spelling /${alias} is not listed`);
    }
  }
});

test('the page opens with a language bar, not with one language', () => {
  const page = readFileSync(PAGE, 'utf8');
  const bar = page.slice(0, page.indexOf('## '));
  for (const lang of DOC_LANGS) assert.ok(bar.includes(`(#${LANG_HEAD[lang].toLowerCase()})`), `no link to ${lang}`);
});

test('/help links to the page, and the link is a URL a chat renders', () => {
  assert.match(DOC_URL, /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/docs\/COMMANDS\.md$/);
  for (const lang of LANGS) assert.ok(String(t(lang, 'help.intro')).includes('{url}'), lang);
});