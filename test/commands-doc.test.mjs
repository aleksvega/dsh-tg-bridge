// docs/COMMANDS.md is the page /help links to, so it has to be the text the bot
// would give — not a page written once in a good week. The generator is the only
// author; this test fails when the committed page and the code disagree, which is
// the moment a stale list starts costing someone a wrong command.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { commandsDoc } from '../scripts/commands-doc.mjs';
import { DOC_URL, HELP_SECTIONS, commandsOf } from '../chat/help-sections.mjs';
import { LANGS, t } from '../core/i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'docs', 'COMMANDS.md');

test('docs/COMMANDS.md is what the generator would write today', () => {
  assert.equal(readFileSync(PAGE, 'utf8'), commandsDoc(), 'run: node scripts/commands-doc.mjs');
});

test('the page names every command, in every language', () => {
  const page = readFileSync(PAGE, 'utf8');
  for (const lang of LANGS) {
    for (const section of HELP_SECTIONS) {
      for (const command of commandsOf(section.id)) {
        assert.ok(page.includes(`\`${command}\``), `${lang}: ${command} is missing from the page`);
      }
      assert.ok(page.includes(t(lang, `help.section.${section.id}`)), `${lang}: section ${section.id} missing`);
    }
  }
});

test('/help links to the page, and the link is a URL a chat renders', () => {
  assert.match(DOC_URL, /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/docs\/COMMANDS\.md$/);
  for (const lang of LANGS) assert.ok(String(t(lang, 'help.intro')).includes('{url}'), lang);
});