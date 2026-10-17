# Tapedeck 📼 coding agent transcripts for Obsidian

Every coding agent session is a tape. Pop a Claude Code, Codex CLI, or Pi session into the deck and get a note you can actually read, labelled and ready to rewind.

## Use

Requires Obsidian 1.13.0 or newer, on desktop.

1. Run **📼 Import from tape shelves**, pick **All enabled shelves** or one shelf, then tick the tapes you want in the tape picker (see below) and press **Import N tapes**. The last shelf row, **⏏️ One-off file…**, opens the file picker below.
2. Or run **⏏️ Import session file** and paste a path or choose a `.jsonl` file. Tapedeck works out which agent wrote it.
3. In a transcript note, run **⏪ Re-import current transcript** to pull the latest version of that session.

Importing a session that already has a note updates that note. It finds it by `session_id`, so you never get duplicates. Re-imports keep `created` and whatever you typed into `project`, and add `updated`.

## Tape picker

After you pick a shelf, the tape picker lists **every** tape on it, newest first (by when the file last changed). Each row shows the agent emoji, date and time, project, and first prompt, for example `🟠 2026-01-15 09:00 · demo · Make the greeting say hello world`. Tapes that already have a note are marked `⏪ in vault`; importing them again updates that note.

- **Search** matches every word you type against the agent, shelf, project, first prompt, and date, so `demo 2026-01` finds January tapes from the demo project.
- **Nothing is selected** when the picker opens. Click rows or use the keyboard to tick them. **Select all N** and **Select none** act on the rows your search currently shows; ticks outside the search are kept and counted as hidden.
- **Keyboard**: ↑/↓ move the highlight (and focus the list), Space ticks the highlighted row, Enter imports what is ticked, typing jumps back to the search field, Esc closes.
- **Import N tapes** imports the ticked tapes, four at a time. A single tape opens its note when done.

The project comes from the session's working directory. Until a tape's first lines are read, Claude Code and Pi rows show a guess from their project folder name (with your home folder stripped, e.g. `code-my-app`); Codex rows show `—`.

Rows appear straight away and first prompts fill in as they are read. Tapedeck reads only the first 64 KB of each tape (1 MB if that is not enough), eight at a time, newest first, and remembers what it read until the file changes, so reopening the picker is instant. Up to 300 matching rows are drawn at once; search still covers every tape.

## Tape shelves

A tape shelf is a saved folder Tapedeck imports from, so you never have to pick a path again. Set them up under **📼 Tape shelves** in settings. Each shelf has:

- **Folder**: where the `.jsonl` files live. `~` means your home folder on every OS (`%USERPROFILE%` on Windows), and is expanded only when Tapedeck reads the folder, so the same settings work on another machine.
- **Label**: optional. Shown instead of the folder in the picker.
- **Agent**: Claude Code, Codex CLI, Pi, or Auto-detect. Auto-detect reads the first lines of each file. It takes files laid out the way their agent writes them, or loose in the shelf folder.
- **On/off toggle**: only enabled shelves count for **All enabled shelves**. You can still pick a disabled one directly.

Add shelves with **+**, edit with the pencil, drag to reorder, delete with the bin. A shelf whose folder does not exist is marked _folder not found_ in settings and _unavailable_ in the picker, and is skipped without an error.

New installs start with one shelf per agent at its default folder:

| Shelf       | Folder                 |
| ----------- | ---------------------- |
| Claude Code | `~/.claude/projects`   |
| Codex CLI   | `~/.codex/sessions`    |
| Pi          | `~/.pi/agent/sessions` |

Pi's default comes from `getSessionsDir()` in [pi's `config.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/config.ts) and its [sessions doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md). If you moved it with `--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, or pi's `sessionDir` setting, edit the Pi shelf to match.

**Restore default shelves** puts those three back and replaces your list. Upgrading from a version with one folder setting per agent keeps any folder you had set on that agent's shelf.

## Sources

| Source      | Default layout                                     | Resume command                     |
| ----------- | -------------------------------------------------- | ---------------------------------- |
| Claude Code | `~/.claude/projects/<project>/<session-id>.jsonl`  | `cd <cwd> && claude --resume <id>` |
| Codex CLI   | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`     | `codex resume <id>`                |
| Pi          | `~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl` | `cd <cwd> && pi --session <id>`    |

On Windows, `~` is `%USERPROFILE%`. Point Tapedeck somewhere else with a tape shelf.

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

- **📼 Tape shelves**: saved folders to import from (see above) and restore defaults. The old "recent sessions to list" setting is gone, since the picker searches every tape; an old value in `data.json` is ignored.
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
