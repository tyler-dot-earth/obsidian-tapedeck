# Tapedeck 📼 agent transcripts for Obsidian

Every agent session is a tape. Pop a Claude Code, ChatGPT / Codex, or Pi session into the deck and get a note you can actually read, labelled and ready to rewind.

## Use

Requires Obsidian 1.13.0 or newer, on desktop.

1. Run **📼 Import from tape shelves**, pick **All enabled shelves** or one shelf, then tick the tapes you want in the tape picker (see below) and press **Import N tapes**. The last shelf row, **⏏️ One-off file…**, opens the file picker below.
2. Or run **⏏️ Import session file** and paste a path or choose a `.jsonl` file. Tapedeck works out which agent wrote it.
3. In a transcript note, run **⏪ Re-import current transcript** to pull the latest version of that session.
4. Or open the **📼 tape rack** sidebar to browse your tapes and import with a click (see below).

Importing a session that already has a note updates that note. It finds it by `session_id`, so you never get duplicates. Re-imports keep `created` and whatever you typed into `project`, and add `updated`.

## Tape picker

After you pick a shelf, the tape picker lists **every** tape on it, newest first (by when the file last changed). Each row shows the agent emoji, date and time, project, and title, for example `🟠 2026-01-15 09:00 · mixtape · Make the greeting say hello world`. Tapes that already have a note are marked `⏪ in vault`, or `⏩ changed since import` when the session file has changed since the note was written; importing them again updates that note.

- **Search** matches every word you type against the agent, shelf, project, title, and date, so `mixtape 2026-01` finds January tapes from the mixtape project.
- **Nothing is selected** when the picker opens. Click rows or use the keyboard to tick them. **Select all N** and **Select none** act on the rows your search currently shows; ticks outside the search are kept and counted as hidden.
- **Keyboard**: ↑/↓ move the highlight (and focus the list), Space ticks the highlighted row, Enter imports what is ticked, typing jumps back to the search field, Esc closes.
- **Import N tapes** imports the ticked tapes, four at a time. A single tape opens its note in a new tab when done.

The project comes from the session's working directory. Until a tape's first lines are read, Claude Code and Pi rows show a guess from their project folder name (with your home folder stripped, e.g. `code-rec-light`); Codex rows show `—`.

Rows appear straight away and titles fill in as they are read. Tapedeck reads only the first 64 KB of each tape (1 MB if that has no prompt) plus the last 64 KB, eight tapes at a time, newest first, and remembers what it read until the file changes, so reopening the picker is instant. Up to 300 matching rows are drawn at once; search still covers every tape.

## Tape rack

The tape rack is a sidebar list of every tape on your enabled shelves. Open it with the cassette ribbon icon or **📼 Open tape rack**; it opens in the right sidebar.

Each row shows a checkbox, the agent emoji, date and time, project (with the worktree, see Projects and worktrees), a badge, and the title (see Tape titles). Badges are **new** (not imported yet), **in vault**, or **changed** (the session file changed after the note's `updated` or `created` time, with a minute of slack).

- **Click a row** to preview it: a read-only window with the title, agent, project and branch, date, turn count, and the first few turns rendered like the note, with **Import** (or **Re-import** and **Open note**) and **Close**. Previewing never writes to the vault. A row that is already in the vault opens its note instead.
- **The row button** imports, or re-imports a tape that is in the vault. With a mouse it appears over the row's right edge on hover, so it takes no width; on touch screens it sits after the badge.
- **Tick rows** and press **Import N tapes** to import several at once; **Clear** drops the ticks. Importing more than 20 at once asks first.
- **After an import** the row stays where it is with an **imported ✓** badge that opens the note, even with **Hide imported** on, until the next refresh or filter change. One tape opens its note in a new tab, with a notice you can click to open it again; several open nothing and give one summary with counts. A tape that fails gets an **import failed** badge (hover for the reason) and a notice.
- **Search** works like the tape picker. Rows are grouped **by project** at first; switch to **by shelf** or **no groups**, click a heading to fold it, or use the fold button to collapse or expand every group. **Hide imported** shows only tapes without a note.
- **Refresh** (↻) re-lists the shelves. The rack also re-lists when it opens, when you come back to it after 30 seconds, and every 5 minutes while it is on screen. Listing never imports anything; only your clicks do, unless you turn on auto-import for a shelf.

Badges follow the vault as notes are added, renamed, or deleted. The rack shares the picker's cache of titles and draws 200 lines at a time (**Show more** adds another 200), so thousands of tapes stay quick. Grouping and the hide toggle are kept with the workspace layout.

## Projects and worktrees

Sessions are grouped by the repo they ran in. A session in a git worktree goes under its main repo with the worktree after it, like `mixtape · side-b`. Tapedeck finds the main repo from the worktree's `.git` file (`gitdir: <repo>/.git/worktrees/<name>`), or, when the worktree is gone, from common layouts: `…/worktrees/<repo>/<name>`, `<repo>/.worktrees/<name>`, and `<repo>-worktrees/<name>`. Before a tape is read, the project comes from its folder name, which Claude Code and Pi encode lossily (`/` and `.` become `-`); Tapedeck matches those names against folders that exist under your home folder, so `-home-me-rec-light` resolves to `~/rec-light` rather than `~/rec/light`.

## Auto-import

Auto-import is off for every shelf until you pick a schedule under **⏰ Auto-import** in settings: every 15 minutes, hourly, or daily. It only runs while Obsidian is open.

- Each run imports new tapes and re-imports changed ones from that shelf, the same as the rack's import button, so it only ever rewrites notes Tapedeck made.
- Only tapes modified after you turned auto-import on are touched, so turning it on never sweeps in your history.
- Subagent threads and empty files are skipped, as in the rack.
- On startup a shelf runs only if a run is due; runs never overlap.
- A run that imports something shows one summary notice and never opens a tab; a run with nothing to do stays quiet.

Turning it off clears the start time, so turning it on again starts fresh.

## Tape titles

A tape's title is, in order:

1. **The agent's own name for the session.** Claude Code: the latest `custom-title` (from `/rename`), else `ai-title`, else an older `summary` line. Codex: the latest `thread_name` for the session in `~/.codex/session_index.jsonl` (from `/rename` or Codex's own naming). Pi: the latest `session_info` name (from `/name`).
2. **The first prompt you typed.** Text the agent injects is skipped: slash-command wrappers, command output, `Caveat:` lines, background-task notices, `<environment_context>`, `<user_instructions>`, AGENTS.md instructions, browser context, the Codex review-history preamble, and the like. Pasted text keeps its content, other tags are stripped, and whitespace is collapsed.
3. **A fallback** such as `/clear only` (only bare commands were run) or `empty tape`.

Names are appended as a session goes, so Tapedeck reads the last 64 KB of each tape as well as the start. Imported notes use the same title for their heading and file name.

The picker and the rack leave out Codex subagent and review threads (they have a parent thread) and Claude Code files with no messages at all; the rack's status line counts them.

## Tape shelves

A tape shelf is a saved folder Tapedeck imports from, so you never have to pick a path again. Set them up under **📼 Tape shelves** in settings. Each shelf has:

- **Folder**: where the `.jsonl` files live. `~` means your home folder on every OS (`%USERPROFILE%` on Windows), and is expanded only when Tapedeck reads the folder, so the same settings work on another machine.
- **Label**: optional. Shown instead of the folder in the picker.
- **Agent**: Claude Code, ChatGPT / Codex, Pi, or Auto-detect. Auto-detect reads the first lines of each file. It takes files laid out the way their agent writes them, or loose in the shelf folder.
- **On/off toggle**: only enabled shelves count for **All enabled shelves**. You can still pick a disabled one directly.

Add shelves with **+**, edit with the pencil, drag to reorder, delete with the bin. A shelf whose folder does not exist is marked _folder not found_ in settings and _unavailable_ in the picker, and is skipped without an error.

New installs start with one shelf per agent at its default folder:

| Shelf           | Folder                 |
| --------------- | ---------------------- |
| Claude Code     | `~/.claude/projects`   |
| ChatGPT / Codex | `~/.codex/sessions`    |
| Pi              | `~/.pi/agent/sessions` |

Pi's default comes from `getSessionsDir()` in [pi's `config.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/config.ts) and its [sessions doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md). If you moved it with `--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, or pi's `sessionDir` setting, edit the Pi shelf to match.

The ↺ **Restore default shelves** button in the shelves card puts those three back and replaces your list. Upgrading from a version with one folder setting per agent keeps any folder you had set on that agent's shelf.

## Sources

| Source          | Default layout                                     | Resume command                     |
| --------------- | -------------------------------------------------- | ---------------------------------- |
| Claude Code     | `~/.claude/projects/<project>/<session-id>.jsonl`  | `cd <cwd> && claude --resume <id>` |
| ChatGPT / Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`     | `codex resume <id>`                |
| Pi              | `~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl` | `cd <cwd> && pi --session <id>`    |

On Windows, `~` is `%USERPROFILE%`. Point Tapedeck somewhere else with a tape shelf.

Each source is one parser behind the `TranscriptSource` interface in `src/tapedeck-transcript.ts`. Adding a harness means writing one more and listing it in `src/tapedeck-sources.ts`.

## Notes

````markdown
---
type: transcript
harness: claude-code
model: 'claude-sonnet-4-5'
session_id: '11111111-2222-4333-8444-555555555555'
machine: 'tape-deck'
cwd: '~/projects/mixtape'
resume: 'cd "~/projects/mixtape" && claude --resume 11111111-…'
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

## Freeze-frames (images)

Images in a tape are saved into the vault as real files and embedded where they appeared.

| Source          | What Tapedeck reads                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | Pasted images (base64 `image` blocks in user messages) and images in tool results, such as `Read` on a PNG.                                                                                                               |
| ChatGPT / Codex | `input_image` items with `data:` URLs in user messages and tool output (`view_image`). A local image Codex tagged by path but did not inline is copied from that path if the file still exists. Remote URLs become links. |
| Pi              | `{ type: "image", data, mimeType }` parts in user messages and tool results.                                                                                                                                              |

- **Where they land**: Obsidian's attachment folder (Settings → Files and links → Default location for new attachments), worked out for the transcript note, so "same folder as current file" and subfolder settings work too.
- **Names** are `tapedeck-<first 8 of session id>-<12 hex of a SHA-256 of the image>.<ext>`. Re-importing a tape reuses the files already there instead of writing `… 1.png` copies, and an image that appears twice in a tape is saved once.
- **Placement**: Claude Code and Codex write `[Image #1]` in the prompt. The embed replaces that placeholder, so `[Image #1] more like this` becomes the image followed by `more like this`. Images without a placeholder stay where they were in the turn. Tool images go inside the tool's callout.
- **When an image cannot be saved** (import is off, it is over the size limit, the file it pointed to is gone, the session only kept an upload id, or the write failed), the note gets a line like `*⏸️ [Image #2] not imported: the file is no longer at ~/shots/gone.png*` instead of an error.

## Privacy and file access

Tapedeck is desktop only because it reads files outside your vault with Node's `fs`. Everything stays on your computer.

- **Reads** session files from the default shelves, `~/.claude/projects`, `~/.codex/sessions`, and `~/.pi/agent/sessions`, plus any shelf folder you add and any file you pick with **⏏️ Import session file**. It also reads `~/.codex/session_index.jsonl` for Codex thread names.
- **Looks at folders under your home folder** to match project and worktree names: it lists folder names and reads worktree `.git` files, nothing else.
- **Copies local images** that a Codex session referenced by path into your vault, if the file still exists.
- **Writes only to your vault**: transcript notes in your import folder, images in your attachment folder, and `tape-cache.json` in Tapedeck's plugin folder, which keeps each tape's title, working directory, and project so a restart does not re-read every tape (delete it any time). It never changes session files.
- **Makes no network requests.** Remote image URLs are kept as links, not downloaded.
- **Redaction is best-effort.** The home-folder and secret patterns catch common cases, not every secret, so read a note before you share it.
- **Notes include a machine name** (your computer's hostname in the `machine` property) unless you turn off **Machine name** under ✂️ Redaction.

## Settings

Each section is its own card.

- **📼 Tape shelves**: saved folders to import from (see above), with the restore defaults button in its header. The old "recent sessions to list" setting is gone, since the picker searches every tape; an old value in `data.json` is ignored.
- **⏰ Auto-import**: a schedule per shelf, off by default (see Auto-import).
- **🏷️ Notes**: import folder, filename pattern (`{date} {time} {harness} {session} {title}`), raw or summary style, fold tool calls, tool output (full, truncated, none), truncate length, include thinking.
- **⏸️ Freeze-frames**: import images (on by default) and a size limit in MB (0, the default, means no limit). Bigger images get a note instead.
- **✂️ Redaction**: home folder as `~`, and mask secrets (API keys, GitHub and Slack tokens, AWS keys, JWTs, bearer headers, private keys, `key=value` secrets). These are simple patterns. Read a note before you share it. **Machine name** (on by default) adds the computer's name as the `machine` property; turn it off to leave the property out.

Summary style keeps what you and the agent said and replaces tool callouts with one line per turn, like `📼 3 tool calls: Read, Edit, Bash`.

License is MIT.

## Sample vault

`example/vault` is an empty vault for trying the plugin. `fixtures/` has a synthetic session for each source, and `fixtures/images/` one per source with tiny generated PNGs. See `example/README.md`.

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
