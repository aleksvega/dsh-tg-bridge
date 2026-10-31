// RU strings. One table per locale, kept in three files so a language stays
// reviewable: `core` holds the words a screen shows (status, settings, panels,
// prompts), `ctrl` what each command answers, `fallback` the failover card. A
// translation change touches one table and shows up as one diff.
import cost from './ru/cost.mjs';
import ctrl from './ru/ctrl.mjs';
import sandbox from './ru/sandbox.mjs';
import core from './ru/core.mjs';
import fallback from './ru/fallback.mjs';
import release from './ru/release.mjs';
import diff from './ru/diff.mjs';
import model from './ru/model.mjs';
import endpoint from './ru/endpoint.mjs';
import every from './ru/every.mjs';
export default { ...core, ...ctrl, ...cost, ...sandbox, ...fallback, ...release, ...diff, ...model, ...endpoint, ...every };
