# Dailies 🎞️ coding agent transcripts for Obsidian

Dailies are the raw footage a film crew watches at the end of each day. This is that, for your coding agents. Roll in a Claude Code, Codex CLI, or Pi session and get a note you can actually read.

## Use

Requires Obsidian 1.13.0 or newer, on desktop.

1. Run **🎬 Import session file** and paste a path or choose a `.jsonl` file. Dailies works out which agent wrote it.
2. Or run **🎞️ Import recent sessions**, pick a source (or all of them), then pick a take. The first row imports every listed session.
3. In a transcript note, run **🔁 Re-import current transcript** to pull the latest version of that session.

Importing a session that already has a note updates that note. It finds it by `session_id`, so you never get duplicates. Re-imports keep `created` and whatever you typed into `project`, and add `updated`.

## Sources

| Source      | Where it looks                                     | Resume command                     |
| ----------- | -------------------------------------------------- | ---------------------------------- |
| Claude Code | `~/.claude/projects/<project>/<session-id>.jsonl`  | `cd <cwd> && claude --resume <id>` |
| Codex CLI   | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`     | `codex resume <id>`                |
| Pi          | `~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl` | `cd <cwd> && pi --session <id>`    |

On Windows, `~` is `%USERPROFILE%`. Point any source somewhere else in settings.

Each source is one parser behind the `TranscriptSource` interface in `src/dailies-transcript.ts`. Adding a harness means writing one more and listing it in `src/dailies-sources.ts`.

## Notes

````markdown
---
type: transcript
harness: claude-code
model: 'claude-sonnet-4-5'
session_id: '11111111-2222-4333-8444-555555555555'
machine: 'my-laptop'
cwd: '~/projects/demo'
resume: 'cd "~/projects/demo" && claude --resume 11111111-…'
date: 2026-01-15T09:00:01
created: 2026-02-01T12:00:00
project:
---

# 🎞️ Make the greeting say hello world

## 🗣️ User · 09:00

## 🤖 Assistant · 09:00

> [!example]- tool: Edit
>
> ```diff
> -export const greet = () => 'hi'
> +export const greet = () => 'hello world'
> ```
````

Tool calls are callouts, folded by default. Input is a JSON block, edits and patches are `diff` blocks, and output is a `text` block. Failed calls use a `failure` callout. Output is kept in full unless you say otherwise.

## Settings

- **📽️ Sources**: a folder per agent (empty means the OS default) and how many recent takes to list.
- **🎞️ Notes**: import folder, filename pattern (`{date} {time} {harness} {session} {title}`), raw or summary style, fold tool calls, tool output (full, truncated, none), truncate length, include thinking.
- **✂️ Redaction**: home folder as `~`, and mask secrets (API keys, GitHub and Slack tokens, AWS keys, JWTs, bearer headers, private keys, `key=value` secrets). These are simple patterns. Read a note before you share it.

Summary style keeps what you and the agent said and replaces tool callouts with one line per turn, like `3 tool calls: Read, Edit, Bash`.

License is MIT.

## Sample vault

`example/vault` is an empty vault for trying the plugin. `fixtures/` has a synthetic session for each source. See `example/README.md`.

## Install for development

Plugin id is `dailies`. Obsidian loads `Vault/.obsidian/plugins/dailies/`.

```bash
pnpm install && pnpm build
```

Symlink only `main.js`, `manifest.json`, and `styles.css`. Do not symlink the whole repo.

```bash
mkdir -p /path/to/Vault/.obsidian/plugins/dailies
ln -sfn /path/to/obsidian-dailies/main.js /path/to/Vault/.obsidian/plugins/dailies/main.js
ln -sfn /path/to/obsidian-dailies/manifest.json /path/to/Vault/.obsidian/plugins/dailies/manifest.json
ln -sfn /path/to/obsidian-dailies/styles.css /path/to/Vault/.obsidian/plugins/dailies/styles.css
```

Add `"dailies"` to `Vault/.obsidian/community-plugins.json`. Reload Obsidian. Turn **Restricted mode** off (Settings → Community plugins) or the plugin will not load.

## Scripts

```bash
pnpm check
pnpm dev
pnpm build
pnpm release -- patch
```
