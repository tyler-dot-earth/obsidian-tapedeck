import type { Transcript } from '#/src/tapedeck-transcript'

/** Pure pieces of the tape preview and the batch-import confirmation. */

/** Turns shown in a preview. */
export const previewTurns = 6

/** Bytes read for a preview; bigger tapes are previewed from their start. */
export const previewBytes = 8 * 1024 * 1024

/** What the preview shows for a tape. */
export interface TapePreview {
	readonly title: string
	readonly startedAt: string | undefined
	/** Turns in the part of the tape that was read. */
	readonly turns: number
	/** Whether only the start of a big tape was read, so `turns` is a lower bound. */
	readonly partial: boolean
	/** The first few turns rendered as the note would render them, without frontmatter. */
	readonly markdown: string
}

/** The transcript cut to its first few turns, for rendering a preview. */
export const previewTranscript = (transcript: Transcript): Transcript => ({
	...transcript,
	turns: transcript.turns.slice(0, previewTurns),
})

/** A note without its YAML frontmatter. */
export const stripFrontmatter = (markdown: string): string =>
	markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart()

/** "12 turns", or "40+ turns" when only part of the tape was read. */
export const turnCount = (preview: TapePreview): string =>
	`${preview.turns}${preview.partial ? '+' : ''} ${preview.turns === 1 && !preview.partial ? 'turn' : 'turns'}`

/** Selections bigger than this ask before importing. */
export const confirmAbove = 20

/** Whether importing this many tapes should ask first. */
export const needsConfirm = (count: number): boolean => count > confirmAbove
