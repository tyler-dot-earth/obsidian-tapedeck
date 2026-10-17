# Sample vault

An empty vault so you can try Dailies without touching a real one.

## Open it

From the plugin repo root, after `pnpm build`:

```bash
bash example/setup-plugin.sh
```

In Obsidian, **Open folder as vault** and pick `example/vault`. Settings → Community plugins → turn **Restricted mode** off, then enable **Dailies**.

Do not symlink the whole plugin repo into `.obsidian/plugins`.

## Try the fixtures

Run **🎬 Import session file** and paste the full path to one of these:

| File                                                      | Source      |
| --------------------------------------------------------- | ----------- |
| `fixtures/claude-code/-home-sample-projects-demo/*.jsonl` | Claude Code |
| `fixtures/codex/2026/01/15/rollout-*.jsonl`               | Codex CLI   |
| `fixtures/pi/--home-sample-projects-demo--/*.jsonl`       | Pi          |

To try **🎞️ Import recent sessions** against them, set each source folder in settings to `fixtures/claude-code`, `fixtures/codex`, or `fixtures/pi` (full paths).

Everything in `fixtures/` is made up.
