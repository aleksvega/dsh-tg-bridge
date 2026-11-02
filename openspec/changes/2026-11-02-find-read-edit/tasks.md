# Tasks — find, read and edit

Ordered so each step is testable alone. Every string gets three locales in the
commit that adds it.

## 0. Ground

- [x] 0.1 One path fence shared by all three commands: resolve, refuse outside the
      workspace, refuse a binary and a file over the size cap, with the reason in
      the message. Test: three refusals, one accept.
- [x] 0.2 A walk with a bound (depth, entries, milliseconds) that returns what it
      reached and says it stopped. Test: a tree larger than the bound returns
      `stopped` and still renders.
- [x] 0.3 `test/file-fence.test.mjs` covers 0.1 and 0.2 before any card exists.

## 1. Browse

- [x] 1.1 `control/cmd-files.mjs`: `/ls [path]` lists folders first, then files, both
      as buttons; a page holds forty and says how many remain. The listing itself
      lives in `chat/file-listing.mjs`, because the press that walks into the next
      folder is in `chat/`, and `chat` must not import `control`.
- [x] 1.2 A folder button opens that folder on the same message; a file button
      opens a preview on a new message with the first forty lines.
- [x] 1.3 A **more** button on a preview extends it by forty lines, until the end.
      `/view <file>[:line]` opens straight into that preview.
- [x] 1.4 `fv:` press with its own tests: a stale button, a missing path, a path
      that became a file since the card was drawn.
- [x] 1.5 Three locales.

## 2. Search

- [x] 2.1 `control/cmd-find.mjs`: `/find <text> [path]` walks the workspace, matches
      a literal string, returns `path:line: text`, capped at twenty rows.
- [x] 2.2 A result is a button that opens the file at that line, through 1.2.
- [x] 2.3 No match is one sentence; more than the cap says how many were found.
- [x] 2.4 A file the fence refuses is skipped silently, and the answer says how many
      files were skipped.
- [x] 2.5 `test/find.test.mjs`: one match, no match, a match inside a skipped file,
      a query with a regex character in it that must not be treated as one.
- [x] 2.6 Three locales.

## 3. Edit

- [x] 3.1 `control/cmd-edit.mjs`: `/edit <path>:<line>` or `<path>:<from>-<to>` shows
      those lines, and the next plain message in the topic is the replacement. The
      intercept sits in `chat/handle-message.mjs` before the unknown-command answer,
      so a replacement that starts with `/` still reaches the file.
- [x] 3.2 An exact replacement that matches once shows a diff preview with the hunk
      and two buttons: **Применить**, **Отмена**.
- [x] 3.3 A replacement matching zero or several times is refused with the count and
      the file left untouched. A range past the end names the real length, and the
      file keeps the trailing newline it had.
- [x] 3.4 The write records a revert entry for the hunk, so `/diff` can undo it; the
      card says so in the same sentence.
- [x] 3.5 `ed:` press with its own tests: apply, cancel, stale press, and a file
      changed between preview and confirm.
- [x] 3.6 Three locales.

## 4. Finish

- [ ] 4.1 Suite green with `DSH_HOME` unset; no new dependency; no module over 500
      lines; every command in the registry and in `/help`.
- [ ] 4.2 Measured on the live bot: a folder of forty entries, a search with one hit
      and one with none, an edit applied and then reverted from `/diff`.
- [ ] 4.3 CHANGELOG names the three commands and their limits (bounded walk, no
      binary, workspace fence).
## 5. Done so far

- 1.40.0 ships 0.x and 2.x: the fence (lib/file-fence.mjs), the bounded walk,
  /find, and the `fs:` press that opens a file at the matched line with a **more**
  button.
- 1.43.0 ships 1.x: `/ls` and `/view` on the same fence and the same paged
  window, plus the `fv:` press that walks into a folder, and fourteen tests.
  1.43.1 fixes what that release exposed: `saveState()` threw on a machine with
  no `~/.dsh/tg-bridge`, so a read command failed on its own bookkeeping.
- 1.44.0 ships 3.x: `/edit` names lines, takes the replacement as the next
  message, shows a diff, and writes only on «Применить» — and only if those lines
  still match. `writeTextFile` joins `readTextFile` in the fence, so the one
  place that knows the rules is still one place. Fifteen tests.
- 4.x stays open: 4.2 is the live measurement, which only the person can do.
