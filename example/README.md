# Sample vault

An empty vault so you can try Tapedeck without touching a real one.

## Open it

From the plugin repo root, after `pnpm build`:

```bash
bash example/setup-plugin.sh
```

In Obsidian, **Open folder as vault** and pick `example/vault`. Settings → Community plugins → turn **Restricted mode** off, then enable **Tapedeck**.

Do not symlink the whole plugin repo into `.obsidian/plugins`.

## Try the fixtures

Run **⏏️ Import session file** and paste the full path to one of these:

| File                                                         | Source                   |
| ------------------------------------------------------------ | ------------------------ |
| `fixtures/claude-code/-home-sample-projects-mixtape/*.jsonl` | Claude Code              |
| `fixtures/codex/2026/01/15/rollout-*.jsonl`                  | Codex CLI                |
| `fixtures/pi/--home-sample-projects-mixtape--/*.jsonl`       | Pi                       |
| `fixtures/images/*.jsonl`                                    | Each source, with images |

To try **📼 Import from tape shelves** against them, add a tape shelf for `fixtures/claude-code`, `fixtures/codex`, or `fixtures/pi` (full paths), or an Auto-detect shelf for `fixtures/images`.

Everything in `fixtures/` is made up.
