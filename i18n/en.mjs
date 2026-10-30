// EN strings. One table per locale, kept in three files so a language stays
// reviewable: `core` holds the words a screen shows (status, settings, panels,
// prompts), `ctrl` what each command answers, `fallback` the failover card. A
// translation change touches one table and shows up as one diff.
import cost from './en/cost.mjs';
import ctrl from './en/ctrl.mjs';
import sandbox from './en/sandbox.mjs';
import core from './en/core.mjs';
import fallback from './en/fallback.mjs';
import release from './en/release.mjs';
import diff from './en/diff.mjs';
export default { ...core, ...ctrl, ...cost, ...sandbox, ...fallback, ...release, ...diff };
