// ZH strings. One table per locale, kept in three files so a language stays
// reviewable: `core` holds the words a screen shows (status, settings, panels,
// prompts), `ctrl` what each command answers, `fallback` the failover card. A
// translation change touches one table and shows up as one diff.
import cost from './zh/cost.mjs';
import ctrl from './zh/ctrl.mjs';
import sandbox from './zh/sandbox.mjs';
import core from './zh/core.mjs';
import fallback from './zh/fallback.mjs';
import release from './zh/release.mjs';
export default { ...core, ...ctrl, ...cost, ...sandbox, ...fallback, ...release };
