# Acceptance criteria for a public release

Date: 24.10.2026. Repository: `dsh-tg-bridge-oss`.
A check is a command or a fact, not an intention.

## R. Release readiness

| # | Criterion | Check |
|---|---|---|
| R1 | README explains what this is, why, and gets a user set up from scratch in ≤5 steps | read it + run the steps on a clean copy |
| R2 | `config.example.json` has no personal data: no chat id, no user paths | `grep -E "[0-9]{7,}" config.example.json` is empty |
| R3 | `LICENSE` (MIT) exists and names the copyright holder | file exists, 20+ lines |
| R4 | `package.json`: name, version, description, scripts (`setup`, `check`, `menu`) | `node -e "require('./package.json')"` |
| R5 | Documentation in `docs/`: CHANGELOG, COST, RELEASE-CRITERIA, ROADMAP, TELEGRAM-SETUP, UX-ANALYSIS | 6 files, no extra duplicates |
| R6 | No secrets or personal ids in the git index | `git ls-files` + grep for tokens/paths |
| R7 | `git status` clean, a release commit tagged with the version exists | `git log --oneline -1`, `git status --short` |
| R8 | `node setup.mjs --check` does not fail on a fresh clone | exit code 0 |
| R9 | All runtime files present and passing `node --check` | every module in `package.json` `files[]`, 0 syntax errors (39 at 1.15.0) |
| R10 | `init --token --user` on an empty `DSH_HOME` produces working credentials and `config.json` | `node cli.mjs init ... --dry-run` + a run in a temp directory |
| R11 | Re-running `init` does not duplicate `refs:` and does not lose other keys | credentials with `MY_PROVIDER_API_KEY` stay in place |
| R12 | `install.sh` sets up autostart: launchd (macOS) / systemd --user (Linux), `--no-autostart` flag | read the file + `bash -n install.sh` |
| R13 | The service finds the token under any `DSH_TELEGRAM_BOT_TOKEN*` name and from env | `check` prints the token length on an empty `DSH_HOME` |

## What counts as "done"

A release is done when R1–R9 **all** pass and the README has a
"Verification" section with commands the user can run themselves.
