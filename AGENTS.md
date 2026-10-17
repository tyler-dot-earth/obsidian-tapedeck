# Tapedeck

Obsidian plugin. Imports coding agent transcripts (Claude Code, Codex CLI, Pi) as markdown notes. Plugin id `tapedeck`. Desktop only (reads session files with `node:fs`). Theme is VHS tape decks: a session is a tape. 📼 main and recent sessions, ⏏️ import, ⏪ re-import, ⏯️ import all, 📺 sources and pickers, 🏷️ notes and frontmatter, ✂️ redaction, ⏹️ errors.

Each harness is a `TranscriptSource` (`src/tapedeck-transcript.ts`): `matchesFile`, `detect`, `parse`, `resumeCommand`. Parsers decode jsonl lines with Effect `Schema` and produce a harness-neutral `Transcript` of turns and blocks (`text`, `thinking`, `note`, `tool`). Tool results are paired with calls by id in a first pass. `src/tapedeck-render.ts` turns a transcript into a note; redaction runs over the whole rendered note. `src/tapedeck-importer.ts` finds an existing note by `harness` + `session_id` frontmatter and updates it instead of creating a duplicate.

## Layout

- `src/main.ts` is the Plugin host: onload/onunload, settings tab, commands
- Package imports: `#/src/tapedeck-plugin-settings`
- Sources: `src/tapedeck-source-claude-code.ts`, `src/tapedeck-source-codex.ts`, `src/tapedeck-source-pi.ts`, registry in `src/tapedeck-sources.ts`
- Tape shelves (saved source folders, never called "bookmarks"): model and `~` expansion in `src/tapedeck-shelves.ts`, listing in `src/tapedeck-session-files.ts`, editor and picker in `src/tapedeck-shelf-modals.ts`. A missing `tapeShelves` key means the defaults; old `*Directory` keys migrate onto the default shelves.
- Tape picker: pure search/selection/project helpers in `src/tapedeck-tape-list.ts`, header reading and the path+size+mtime cache in `src/tapedeck-tape-info.ts`, the modal in `src/tapedeck-tape-picker.ts`. Never select tapes by default.
- Images ("freeze-frames"): parsers emit `image` blocks and `ToolBlock.images` as `ImageSource` (`inline`/`file`/`url`/`missing`); pure helpers and `[Image #N]` placement in `src/tapedeck-images.ts`; `src/tapedeck-image-import.ts` saves them (content-hash names) and swaps in `vault` embeds before rendering. Image fixtures in `fixtures/images/` use generated PNGs only.
- `fixtures/` holds synthetic sessions only. Never commit a real session file.
- `effect-obsidian` is `@tyler.earth/effect-obsidian` on npm
- Release artifacts at repo root: `main.js`, `manifest.json`, `styles.css`

## Effect

- Latest Effect v4 rc. Installed modules we lean on: `Effect`, `Schema`, `Option`, `Result`, `Layer`, `Logger`.
- Plugin class is the host boundary. `onload` may `await runtime.runPromise(...)`
- Inside Effect modules: no `async`/`await`, no `try`/`catch`, no `Date.now`
- IO uses `Effect.fn("Tapedeck.operation")` and `Schema.TaggedError`. Vanilla DOM and vault writes stay outside Effect.
- External JSON is decoded with `Schema` at the boundary, never with `typeof`.
- Tests: `@effect/vitest` `it.effect` and `assert`. Vitest runs with `TZ=UTC`.

## Install into a vault

Plugin id is `tapedeck`. After `pnpm build` or `pnpm dev`, symlink (preferred) or copy only `main.js`, `manifest.json`, and `styles.css` into `Vault/.obsidian/plugins/tapedeck/`. Do not symlink the whole repo. Add `"tapedeck"` to `community-plugins.json` without dropping other ids. Sample vault is `example/vault`. See `example/README.md`.

## Tooling

- pnpm, oxfmt, oxlint (type-aware), vitest, esbuild
- Vendored anti-slop at `tools/oxlint/anti-slop/` (generic + Effect plugins)
- `pnpm check` before push
