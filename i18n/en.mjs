// EN strings. One table per locale, kept in two files so a language stays
// reviewable: `core` holds the words a screen shows (status, settings, panels,
// prompts), `ctrl` holds what each command answers. A translation change touches
// one table and shows up as one diff.
import ctrl from './en/ctrl.mjs';
import core from './en/core.mjs';

export default { ...core, ...ctrl };
