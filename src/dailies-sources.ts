import { claudeCodeSource } from '#/src/dailies-source-claude-code'
import { codexSource } from '#/src/dailies-source-codex'
import { piSource } from '#/src/dailies-source-pi'
import { type Harness, jsonLines, type TranscriptSource } from '#/src/dailies-transcript'

/** Every harness Dailies can read. Add new sources here. */
export const transcriptSources: ReadonlyArray<TranscriptSource> = [
	claudeCodeSource,
	codexSource,
	piSource,
]

/** Source for a harness id. */
export const sourceFor = (harness: Harness): TranscriptSource =>
	transcriptSources.find((source) => source.harness === harness) ?? claudeCodeSource

const headLineCount = 8

/** Picks the source whose format matches the first lines of a file. */
export const detectSource = (text: string): TranscriptSource | undefined => {
	const head = jsonLines(text.slice(0, 200_000)).slice(0, headLineCount)

	return transcriptSources.find((source) => source.detect(head))
}
