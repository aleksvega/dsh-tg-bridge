# Tasks — MCP from the chat

## 0. Read what the profile already says

- [x] 0.1 `control/mcp-config.mjs`: parse the `mcp-client` entries out of a
      profile's `cordis.patch.yml` — id, server name, transport, url or command.
      `test/mcp-config.test.mjs` runs it against the real `headless` shape
      (`mcp-exa`, streamable-http) copied into a fixture, plus a file with no MCP
      block and a file with two entries. The real shape is a list of patch entries,
      each `- insert:` holding one or more plugins, and the MCP one is
      `{id: mcp-exa, name: '@deepseek-ai/dsh-mcp-client', config: {transport,
      serverName, url}}`; `serverName` is the name the person says, `id` is the
      patch row. A server identified by `id` alone would be a different command.
- [x] 0.2 Redaction: a header value, a token inside a URL query and an `env` value
      render as `***`. Test: three shapes, all redacted, and the untouched parts of
      the URL still visible.
- [x] 0.3 A missing profile file is one sentence, not an exception. Test: a path
      that does not exist.

## 1. The card

- [x] 1.1 `control/cmd-mcp.mjs`: `/mcp` draws one row per server with its transport
      and a button per server; `/mcp <name>` opens one server.
- [x] 1.2 The single-server card shows the endpoint with secrets redacted, the tool
      names when the host published them, and the last start error when there is one.
- [x] 1.3 A tool row copies the name into the chat and runs nothing.
- [x] 1.4 `mcp:` router with its own tests: a stale button, a server removed from the
      file since the card was drawn, a press on a tool row.
- [x] 1.5 Three locales.

## 2. Writing a profile

- [x] 2.1 `/mcp add <name> <url>` previews the YAML it will insert and writes only
      after **Добавить**.
- [x] 2.2 The write re-parses the file first; a file that no longer parses is
      refused with the reason and left untouched.
- [x] 2.3 A second add with the same server name is refused with the name.
- [x] 2.4 `/mcp rm <name>` removes only an entry the chat added, marked in the same
      file; an entry that was there before is refused.
- [x] 2.5 After a write the card says a restart is needed, and does not claim the
      server is running.
- [x] 2.6 `test/mcp-write.test.mjs`: add, parse back, remove, refuse a foreign entry,
      refuse a duplicate, refuse an unparsable file.

## 3. Finish

- [x] 3.1 Suite green with `DSH_HOME` unset; no new dependency; no module over 500
      lines; `/mcp` in the registry, in `/help` and in the settings card.
- [ ] 3.2 Measured on the live bot: `/mcp` lists `exa`, a tool row copies its name,
      an add is previewed and cancelled, and a remove of `exa` is refused.
- [x] 3.3 CHANGELOG names the surface and its limits (no tool execution, no OAuth,
      restart required).