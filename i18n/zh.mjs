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
import diff from './zh/diff.mjs';
import model from './zh/model.mjs';
import endpoint from './zh/endpoint.mjs';
import every from './zh/every.mjs';
import mcp from './zh/mcp.mjs';
import plan from './zh/plan.mjs';
import dsh from './zh/dsh.mjs';
import supervision from './zh/supervision.mjs';
import files from './zh/files.mjs';
import balance from './zh/balance.mjs';
import branch from './zh/branch.mjs';
import history from './zh/history.mjs';
import remember from './zh/remember.mjs';
export default { ...core, ...ctrl, ...cost, ...sandbox, ...fallback, ...release, ...diff, ...model, ...endpoint, ...every, ...mcp, ...plan, ...dsh, ...supervision, ...files, ...balance, ...branch, ...history, ...remember };
