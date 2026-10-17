# Tapedeck 📼 coding agent transcripts for Obsidian

Every coding agent session is a tape. Pop a Claude Code, Codex CLI, or Pi session into the deck and get a note you can actually read, labelled and ready to rewind.

## Use

Requires Obsidian 1.13.0 or newer, on desktop.

1. Run **⏏️ Import session file** and paste a path or choose a `.jsonl` file. Tapedeck works out which agent wrote it.
2. Or run **📼 Import recent sessions**, pick a source (or all of them), then pick a tape. The first row imports every listed session.
3. In a transcript note, run **⏪ Re-import current transcript** to pull the latest version of that session.

Importing a session that already has a note updates that note. It finds it by `session_id`, so you never get duplicates. Re-imports keep `created` and whatever you typed into `project`, and add `updated`.

## Sources

| Source      | Where it looks                                     | Resume command                     |
| ----------- | -------------------------------------------------- | ---------------------------------- |
| Claude Code | `~/.claude/projects/<project>/<session-id>.jsonl`  | `cd <cwd> && claude --resume <id>` |
| Codex CLI   | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`     | `codex resume <id>`                |
| Pi          | `~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl` | `cd <cwd> && pi --session <id>`    |

On Windows, `~` is `%USERPROFILE%`. Point any source somewhere else in settings.

Each source is one parser behind the `TranscriptSource` interface in `src/tapedeck-transcript.ts`. Adding a harness means writing one more and listing it in `src/tapedeck-sources.ts`.

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

# 📼 Make the greeting say hello world

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

- **📺 Sources**: a folder per agent (empty means the OS default) and how many recent tapes to list.
- **🏷️ Notes**: import folder, filename pattern (`{date} {time} {harness} {session} {title}`), raw or summary style, fold tool calls, tool output (full, truncated, none), truncate length, include thinking.
- **✂️ Redaction**: home folder as `~`, and mask secrets (API keys, GitHub and Slack tokens, AWS keys, JWTs, bearer headers, private keys, `key=value` secrets). These are simple patterns. Read a note before you share it.

Summary style keeps what you and the agent said and replaces tool callouts with one line per turn, like `📼 3 tool calls: Read, Edit, Bash`.

License is MIT.

## Sample vault

`example/vault` is an empty vault for trying the plugin. `fixtures/` has a synthetic session for each source. See `example/README.md`.

## Install for development

Plugin id is `tapedeck`. Obsidian loads `Vault/.obsidian/plugins/tapedeck/`.

```bash
pnpm install && pnpm build
```

Symlink only `main.js`, `manifest.json`, and `styles.css`. Do not symlink the whole repo.

```bash
mkdir -p /path/to/Vault/.obsidian/plugins/tapedeck
ln -sfn /path/to/obsidian-tapedeck/main.js /path/to/Vault/.obsidian/plugins/tapedeck/main.js
ln -sfn /path/to/obsidian-tapedeck/manifest.json /path/to/Vault/.obsidian/plugins/tapedeck/manifest.json
ln -sfn /path/to/obsidian-tapedeck/styles.css /path/to/Vault/.obsidian/plugins/tapedeck/styles.css
```

Add `"tapedeck"` to `Vault/.obsidian/community-plugins.json`. Reload Obsidian. Turn **Restricted mode** off (Settings → Community plugins) or the plugin will not load.

## Scripts

```bash
pnpm check
pnpm dev
pnpm build
pnpm release -- patch
```
