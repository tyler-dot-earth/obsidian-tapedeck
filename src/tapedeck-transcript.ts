import type { Result } from 'effect'

import type { TapedeckParseError } from '#/src/tapedeck-errors'
import type { TitleSource } from '#/src/tapedeck-tape-title'

/** Coding agent that wrote the session file. */
export type Harness = 'claude-code' | 'codex' | 'pi'

/** Plain prose from the user or the assistant. */
export interface TextBlock {
	readonly kind: 'text'
	readonly text: string
}

/** Model reasoning the harness chose to store. */
export interface ThinkingBlock {
	readonly kind: 'thinking'
	readonly text: string
}

/** Harness note such as a compaction summary. */
export interface NoteBlock {
	readonly kind: 'note'
	readonly title: string
	readonly text: string
}

/**
 * Where an image's bytes are. Parsers produce `inline` (base64 in the session file), `file` (a path
 * the harness recorded), `url`, or `missing`. The importer turns `inline` and `file` into `vault`
 * (saved as an attachment, with the embed to write) or `missing` (with the reason).
 */
export type ImageSource =
	| { readonly kind: 'inline'; readonly mimeType: string; readonly base64: string }
	| { readonly kind: 'file'; readonly path: string }
	| { readonly kind: 'url'; readonly url: string }
	| { readonly kind: 'vault'; readonly embed: string }
	| { readonly kind: 'missing'; readonly reason: string }

/** An image in a turn. `label` is the harness's placeholder text, such as `[Image #1]`. */
export interface ImageBlock {
	readonly kind: 'image'
	readonly source: ImageSource
	readonly label: string | undefined
}

/** One tool call with its result, if the result was recorded. */
export interface ToolBlock {
	readonly kind: 'tool'
	readonly name: string
	readonly input: string
	readonly diff: string | undefined
	readonly output: string | undefined
	readonly isError: boolean
	/** Images the tool returned, such as a screenshot or an image file it read. */
	readonly images: ReadonlyArray<ImageSource>
}

export type TranscriptBlock = TextBlock | ThinkingBlock | NoteBlock | ToolBlock | ImageBlock

export type TurnRole = 'user' | 'assistant'

/** Consecutive blocks from one speaker. */
export interface TranscriptTurn {
	readonly role: TurnRole
	readonly timestamp: string | undefined
	readonly blocks: ReadonlyArray<TranscriptBlock>
}

/** Harness-neutral session, ready to render. */
export interface Transcript {
	readonly harness: Harness
	readonly sessionId: string
	readonly model: string | undefined
	readonly cwd: string | undefined
	readonly startedAt: string | undefined
	readonly title: string
	readonly titleSource: TitleSource
	/** A helper thread the agent started (a Codex subagent or review), not a session you ran. */
	readonly subagent: boolean
	readonly turns: ReadonlyArray<TranscriptTurn>
}

/** Recorded tool result, keyed by call id while a parser walks the file. */
export interface ToolResult {
	readonly output: string
	readonly isError: boolean
	readonly diff: string | undefined
	readonly images: ReadonlyArray<ImageSource>
}

/**
 * One harness. Add a source by implementing this and listing it in `tapedeck-sources.ts`.
 * `relativePath` is the path under the source directory, with forward slashes.
 */
export interface TranscriptSource {
	readonly harness: Harness
	readonly label: string
	readonly emoji: string
	readonly defaultDirectory: ReadonlyArray<string>
	readonly matchesFile: (relativePath: string) => boolean
	readonly detect: (headLines: ReadonlyArray<string>) => boolean
	readonly parse: (text: string) => Result.Result<Transcript, TapedeckParseError>
	readonly resumeCommand: (transcript: Transcript) => string
}

/** Tool block fields that come from its recorded result, with defaults when there is none. */
export const toolResultFields = (
	result: ToolResult | undefined,
): Pick<ToolBlock, 'output' | 'isError' | 'images'> => ({
	output: result?.output,
	isError: result?.isError ?? false,
	images: result?.images ?? [],
})

/** Appends blocks, merging into the previous turn when the speaker did not change. */
export const appendTurn = (
	turns: Array<TranscriptTurn>,
	next: TranscriptTurn,
): Array<TranscriptTurn> => {
	if (next.blocks.length === 0) {
		return turns
	}

	const last = turns.at(-1)

	if (last?.role === next.role) {
		turns[turns.length - 1] = {
			role: last.role,
			timestamp: last.timestamp ?? next.timestamp,
			blocks: [...last.blocks, ...next.blocks],
		}

		return turns
	}

	turns.push(next)

	return turns
}

/** Splits a jsonl file into non-empty lines. */
export const jsonLines = (text: string): ReadonlyArray<string> =>
	text.split(/\r?\n/).filter((line) => line.trim() !== '')
