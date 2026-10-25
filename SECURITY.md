# Security

## Reporting

Open a private security advisory on GitHub
(`Security` → `Advisories` → `Report a vulnerability`) or email the maintainer
listed on the npm package page. Do not open a public issue for a working
exploit.

Include the version, the platform, and the smallest reproduction you can. A
Telegram bot token or a session archive in the report is a credential leak:
rotate the token with [@BotFather](https://t.me/BotFather) before sending it.

## What the bridge can do

The bridge runs the harness with the permissions of the profile it starts
(`headless` by default), from the directory bound to the topic. Anyone who can
message the bot and passes `allowedUserIds` can run tools on that machine.
Treat the bot token and the allowlist as root access:

- keep `allowedUserIds` non-empty and limited to your own numeric id;
- keep the token in `~/.dsh/.credentials.yaml`, never in `config.json`, a
  commit, or a screenshot;
- run the bridge under a dedicated OS user if other people share the machine;
- revoke the token in BotFather if it ever appears in a log or a chat.

The bridge does not ship a sandbox. Isolation comes from the DSH profile's
permission mode and the OS account, not from this project.

## Supported versions

The latest `1.x` release receives fixes. A report against an older version is
still welcome, but the fix may land only in the current line.
