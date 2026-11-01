# Tasks — MCP from the chat

## 0. Read what the profile already says

- [ ] 0.1 `control/mcp-config.mjs`: parse the `mcp-client` entries out of a
      profile's `cordis.patch.yml` — id, server name, transport, url or command.
      `test/mcp-config.test.mjs` runs it against the real `headless` shape
      (`mcp-exa`, streamable-http) copied into a fixture, plus a file with no MCP
      block and a file with two entries.
- [ ] 0.2 Redaction: a header value, a token inside a URL query and an `env` value
      render as `***`. Test: three shapes, all redacted, and the untouched parts of
      the URL still visible.
- [ ] 0.3 A missing profile file is one sentence, not an exception. Test: a path
      that does not exist.

## 1. The card

- [ ] 1.1 `control/cmd-mcp.mjs`: `/mcp` draws one row per server with its transport
      and a button per server; `/mcp <name>` opens one server.
- [ ] 1.2 The single-server card shows the endpoint with secrets redacted, the tool
      names when the host published them, and the last start error when there is one.
- [ ] 1.3 A tool row copies the name into the chat and runs nothing.
- [ ] 1.4 `mcp:` router with its own tests: a stale button, a server removed from the
      file since the card was drawn, a press on a tool row.
- [ ] 1.5 Three locales.

## 2. Writing a profile

- [ ] 2.1 `/mcp add <name> <url>` previews the YAML it will insert and writes only
      after **Добавить**.
- [ ] 2.2 The write re-parses the file first; a file that no longer parses is
      refused with the reason and left untouched.
- [ ] 2.3 A second add with the same server name is refused with the name.
- [ ] 2.4 `/mcp rm <name>` removes only an entry the chat added, marked in the same
      file; an entry that was there before is refused.
- [ ] 2.5 After a write the card says a restart is needed, and does not claim the
      server is running.
- [ ] 2.6 `test/mcp-write.test.mjs`: add, parse back, remove, refuse a foreign entry,
      refuse a duplicate, refuse an unparsable file.

## 3. Finish

- [ ] 3.1 Suite green with `DSH_HOME` unset; no new dependency; no module over 500
      lines; `/mcp` in the registry, in `/help` and in the settings card.
- [ ] 3.2 Measured on the live bot: `/mcp` lists `exa`, a tool row copies its name,
      an add is previewed and cancelled, and a remove of `exa` is refused.
- [ ] 3.3 CHANGELOG names the surface and its limits (no tool execution, no OAuth,
      restart required).