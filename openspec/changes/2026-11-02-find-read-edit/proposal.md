# Look, find and change a file without the desktop

## Why

Three acts a person does constantly in the desktop app have no answer in the
chat, and each one ends in the same workaround: ask the agent to print something
and read it in the answer.

**Browse.** The chat can send a file (`/send`) but not show what is in a folder.
Finding the right path means remembering it or asking a turn to `ls` for you.

**Search.** `/sessions` lists sessions and `/diff` shows one change. Nothing
searches a project — on a phone, with no editor, "where is this string" is the
question that sends a person back to the desk.

**Edit.** `/diff` can revert a hunk. Nothing can change one line: a typo fix costs
a whole turn and a provider round trip.

## What changes

1. **`/ls [path]`** lists one directory, folders first, as buttons. A folder opens
   the next level; a file opens a preview with the first lines and a **more**
   button. Nothing outside the topic's workspace is listed without an explicit
   absolute path.
2. **`/find <text> [path]`** searches the topic's workspace for a literal string
   and answers with `path:line` plus the matching line, capped and paged. It walks
   with a bound, skips binary and ignored directories, and never reads a file it
   would have to redact.
3. **`/edit <path>`** changes a file by exact replacement: the person sends the
   old text and the new text, the bridge shows the diff it would make and writes
   only after **Применить**. An ambiguous match is refused with the count.
4. **The diff card is the undo.** Every write records the same hunk `/diff`
   already reverts, so a bad edit is one button away from being undone.

## Priority

P2 in `2026-11-01-desktop-parity` (#8–#10). Behind approvals and the turn
surfaces, ahead of MCP and the plugin settings screen.

## Non-goals

- No editor. Multi-line editing, syntax highlighting and a cursor are a desktop
  surface; this is "change this line, show me the hunk".
- No index. A bounded walk over the workspace is enough for a phone-sized project
  and has no state to corrupt.
- No binary preview, no image viewer: `/send` already hands a file over intact.
- No writes outside the topic's workspace, ever, including with an absolute path.

## Definition of done

1. `/ls` on a folder with more entries than fit answers with a page and a way to
   the next one; a path with a space works.
2. `/find` on a string that appears once returns it with the line number, and on
   a string that appears nowhere says so instead of an empty message.
3. `/edit` refuses an ambiguous replacement, shows the diff, writes only after the
   confirm press, and the written file is byte-identical to what the preview said.
4. A refused path (outside the workspace, binary, too large) is one sentence with
   the reason, never a stack trace.
5. Three locales in the same commit; every press answered inside the quiet guard.

## Impact

- **Users**: three daily desktop acts become one command each.
- **Maintainer**: three commands, one card each, following `/diff`'s shape; no new
  dependency and no module over 500 lines.
- **Risk**: `/edit` writes to a real file. Mitigated by preview-then-confirm and by
  the existing diff revert; the workspace fence is the same check `/cd` uses.