import type { Result } from 'effect'

import type { TapedeckParseError } from '#/src/tapedeck-errors'

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

/** One tool call with its result, if the result was recorded. */
export interface ToolBlock {
	readonly kind: 'tool'
	readonly name: string
	readonly input: string
	readonly diff: string | undefined
	readonly output: string | undefined
	readonly isError: boolean
}

export type TranscriptBlock = TextBlock | ThinkingBlock | NoteBlock | ToolBlock

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
	readonly turns: ReadonlyArray<TranscriptTurn>
}

/** Recorded tool result, keyed by call id while a parser walks the file. */
export interface ToolResult {
	readonly output: string
	readonly isError: boolean
	readonly diff: string | undefined
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

const titleLength = 72

/** First line of the first user prompt, trimmed for a note title. */
export const titleFromTurns = (turns: ReadonlyArray<TranscriptTurn>): string => {
	for (const turn of turns) {
		const text = turn.role === 'user' ? firstText(turn) : undefined

		if (text !== undefined) {
			const line = text.trim().split('\n')[0]?.trim() ?? ''

			return line.length > titleLength ? `${line.slice(0, titleLength - 1)}…` : line
		}
	}

	return 'Untitled session'
}

const firstText = (turn: TranscriptTurn): string | undefined => {
	for (const block of turn.blocks) {
		if (block.kind === 'text' && block.text.trim() !== '') {
			return block.text
		}
	}

	return undefined
}

/** Splits a jsonl file into non-empty lines. */
export const jsonLines = (text: string): ReadonlyArray<string> =>
	text.split(/\r?\n/).filter((line) => line.trim() !== '')
