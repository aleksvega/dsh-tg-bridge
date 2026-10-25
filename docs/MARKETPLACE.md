# Publishing in the DSH marketplace

The market is not a separate service with its own API: it is a catalog of npm
packages that declare a DSH bundle, and DSH installs them with
`dsh plugin add <name>`.

## What the catalog reads

An entry exists because a YAML file in
[`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
points at the repository. Its CI checks, in order:

1. the package declares `dsh.bundle` (a `dsh.client` alone is rejected);
2. `cordis.patch.yml` exists and inserts the plugin;
3. the repository is at least one day old;
4. the description matches the code.

The npm package is optional for listing, but its `repository` field must point
back at the listed repository for download counts to attach. DSH gates
installation on `engines.dsh`: when that field exists it decides alone and
`peerDependencies` is ignored. Without it, every `@deepseek-ai/dsh-*` peer must
satisfy the runtime. The per-profile
`discovery-compatibility-v1.json` is only a display cache for catalog entries,
not the install gate.

## This repository

`package.json` carries:

```json
"engines": {
  "node": ">=20",
  "dsh": ">=0.2.1-rc.2 <0.3.0-0 || >=0.2.2-rc.1 <0.3.0-0"
},
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

Only `dsh.bundle.patch` makes the package installable as a plugin;
`engines.dsh` decides compatibility. `dsh.manifestVersion` and
`dsh.compatibility` are not read by DSH core, so this package does not declare
them. The prerelease branch mirrors what catalog entries do: a plain
`<0.3.0` range silently excludes `0.2.2-*` prereleases.

`cordis.patch.yml` inserts `tg-bridge` (`dsh-tg-bridge`); `plugin-bridge.mjs`
starts one bridge process when the host boots and stops it on shutdown. A live
`bridge.pid` wins, so the scheduled-task install and the plugin never poll the
same bot twice.

The version range is deliberately narrow. The bridge spawns the `0.2.x` CLI
with `--profile`, `--json` and `--session-id`, and reads the `0.2.x` profile
and session layout. A `0.3.0` release must be tested before widening the range.

## Submitting

1. Add the `dsh-plugin` topic to the GitHub repository.
2. Fork `awesome-dsh-plugin`, add one file
   `data/plugins/<owner>__<repo>.yml`:

   ```yaml
   url: https://github.com/<owner>/dsh-tg-bridge
   name: <owner>/dsh-tg-bridge
   category: remote
   description:
     en: 'Telegram bridge for DeepSeek Harness: each forum topic is a project with its own session, text, voice and photo input, live progress and /cd.'
     zh: 'DeepSeek Harness 的 Telegram 桥：每个论坛话题是一个独立项目，有自己的会话、文字/语音/图片输入、实时进度和 /cd。'
   ```

   Quote the English description: it contains `: `, which YAML otherwise reads
   as a nested key.
3. Open the PR. CI checks the manifest and repo age; a maintainer reads the
   code against the description.
4. After the merge the site rebuilds and `dsh-plugin-catalog` is republished;
   DSH picks the entry up from the index source
   `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`.

A PR can add at most three entries.

## Remaining blockers

- Repo age: the catalog's CI rejects repositories younger than one day. This
  repository was created on 2026-10-24 07:38 UTC, so the PR can be opened after
  2026-10-25 07:38 UTC. The `dsh-plugin` topic is already set and the entry is
  ready in the listing below.
- The GitHub account that owns this repository is a personal handle. It is the
  last personal identifier in the project and it is what a marketplace entry
  shows as the owner. Removing it requires transferring the repository to a
  neutral organization (or renaming the account); the install commands no
  longer depend on it, they use `npx dsh-tg-bridge@latest`.
- The plugin entry point has been syntax-checked and packaged, but not yet
  loaded by a running DSH desktop. Install it into a scratch profile
  (`dsh plugin --profile web add link:<repo>`) before submitting, so the
  "starts the bridge" claim is tested end to end.
