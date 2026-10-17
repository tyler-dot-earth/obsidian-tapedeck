# Dailies

Obsidian plugin. Imports coding agent transcripts (Claude Code, Codex CLI, Pi) as markdown notes. Plugin id `dailies`. Desktop only (reads session files with `node:fs`). Theme is film dailies: 🎞️ reel, 🎬 import, 📽️ sources, 🔁 re-import, ✂️ redaction.

Each harness is a `TranscriptSource` (`src/dailies-transcript.ts`): `matchesFile`, `detect`, `parse`, `resumeCommand`. Parsers decode jsonl lines with Effect `Schema` and produce a harness-neutral `Transcript` of turns and blocks (`text`, `thinking`, `note`, `tool`). Tool results are paired with calls by id in a first pass. `src/dailies-render.ts` turns a transcript into a note; redaction runs over the whole rendered note. `src/dailies-importer.ts` finds an existing note by `harness` + `session_id` frontmatter and updates it instead of creating a duplicate.

## Layout

- `src/main.ts` is the Plugin host: onload/onunload, settings tab, commands
- Package imports: `#/src/dailies-plugin-settings`
- Sources: `src/dailies-source-claude-code.ts`, `src/dailies-source-codex.ts`, `src/dailies-source-pi.ts`, registry in `src/dailies-sources.ts`
- `fixtures/` holds synthetic sessions only. Never commit a real session file.
- `effect-obsidian` is `@tyler.earth/effect-obsidian` on npm
- Release artifacts at repo root: `main.js`, `manifest.json`, `styles.css`

## Effect

- Latest Effect v4 rc. Installed modules we lean on: `Effect`, `Schema`, `Option`, `Result`, `Layer`, `Logger`.
- Plugin class is the host boundary. `onload` may `await runtime.runPromise(...)`
- Inside Effect modules: no `async`/`await`, no `try`/`catch`, no `Date.now`
- IO uses `Effect.fn("Dailies.operation")` and `Schema.TaggedError`. Vanilla DOM and vault writes stay outside Effect.
- External JSON is decoded with `Schema` at the boundary, never with `typeof`.
- Tests: `@effect/vitest` `it.effect` and `assert`. Vitest runs with `TZ=UTC`.

## Install into a vault

Plugin id is `dailies`. After `pnpm build` or `pnpm dev`, symlink (preferred) or copy only `main.js`, `manifest.json`, and `styles.css` into `Vault/.obsidian/plugins/dailies/`. Do not symlink the whole repo. Add `"dailies"` to `community-plugins.json` without dropping other ids. Sample vault is `example/vault`. See `example/README.md`.

## Tooling

- pnpm, oxfmt, oxlint (type-aware), vitest, esbuild
- Vendored anti-slop at `tools/oxlint/anti-slop/` (generic + Effect plugins)
- `pnpm check` before push
