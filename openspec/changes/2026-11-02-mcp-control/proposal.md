# MCP servers the chat cannot see

## Why

The profile already runs MCP servers: `profiles/headless/cordis.patch.yml` holds
`mcp-exa` (`@deepseek-ai/dsh-mcp-client`, streamable-http, `mcp.exa.ai`), and every
profile on this machine carries the same block. The desktop app shows those
servers and their tools; the chat shows nothing.

The consequence is a silent capability: `web_search_exa` and `web_fetch_exa` are
tools the agent can call, and a person reading the chat has no way to learn they
exist, no way to see whether a server is up, and no way to add a second one
without editing YAML on the machine.

## What changes

1. **`/mcp` lists the servers this topic's profile runs** — name, transport, and
   the tools each one exposes when the host reports them. Read from the profile's
   own `cordis.patch.yml`, so the card cannot disagree with what the host loads.
2. **`/mcp <name>` shows one server**: its URL or command with the secret parts
   removed, its tools, and whether the last host start reported an error.
3. **`/mcp add <name> <url>`** appends one `mcp-client` entry to the topic's
   profile after a preview of the YAML it will write, and says a restart is needed.
   **`/mcp rm <name>`** removes the entry it wrote, refused for an entry the person
   did not add from the chat.
4. **No tool execution from this card.** It reads configuration and writes
   configuration; calling a tool stays the agent's job.

## Priority

P2 in `2026-11-01-desktop-parity` (#11). Behind the turn surfaces, ahead of the
plugin settings screen: this is one plugin family with a known shape, while plugin
settings are every plugin's own schema.

## Non-goals

- No MCP client of our own: the host runs the transport, the bridge only reads and
  writes the profile.
- No tool browser with invocation. Pressing a tool name copies it, nothing runs.
- No OAuth flow for a remote server; a server needing a token is added with the
  token in the profile by hand, and the card says so.
- No secrets on screen: a header value, a token in a URL and an API key are
  redacted by the same rule `/logs` uses.

## Definition of done

1. `/mcp` on this machine lists `exa` with its transport, and the list is byte-for-
   byte derivable from the profile file (a test asserts the parse, not the prose).
2. `/mcp add` writes a valid entry, the profile still parses, and a second
   `/mcp add` with the same name is refused.
3. `/mcp rm` refuses an entry that was not added from the chat.
4. A server whose config carries a token prints it as `***` in every view.
5. Three locales in the same commit; every press answered inside the quiet guard.

## Impact

- **Users**: the tools the install already has become visible and one server can be
  added without touching the machine.
- **Maintainer**: one command family, one card, one writer into a profile file that
  already has a writer (`/endpoint`, `/fallback`); no new dependency.
- **Risk**: writing a profile file by hand-parsing YAML. Mitigated by editing the
  same `- insert:` list the file already uses and by re-parsing the file before the
  write lands.