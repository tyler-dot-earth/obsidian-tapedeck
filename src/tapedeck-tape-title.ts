import { Schema } from 'effect'

import { decodeJsonLines } from '#/src/tapedeck-json'
import type { Harness, TranscriptTurn } from '#/src/tapedeck-transcript'

/**
 * Tape titles. A tape is named, in order, by the harness's own session name, by the first prompt
 * the user actually typed, or by a short fallback such as `/clear only` or `empty tape`.
 */

/** Where a title came from. */
export type TitleSource = 'name' | 'prompt' | 'fallback'

/** A tape's title and where it came from. */
export interface TapeTitle {
	readonly title: string
	readonly source: TitleSource
}

const titleLength = 72

/** Collapses whitespace and shortens to a title. */
export const clampTitle = (text: string): string => {
	const line = text.replaceAll(/\s+/g, ' ').trim()

	return line.length > titleLength ? `${line.slice(0, titleLength - 1).trimEnd()}…` : line
}

/**
 * Harness-injected blocks dropped with their content: command output, background-task notices,
 * environment and instructions context, browser state, and similar wrappers.
 */
const droppedTags = [
	'command-message',
	'local-command-stdout',
	'local-command-stderr',
	'local-command-caveat',
	'bash-stdout',
	'bash-stderr',
	'task-notification',
	'system-reminder',
	'environment_context',
	'user_instructions',
	'permissions instructions',
	'recommended_plugins',
	'in-app-browser-context',
	'codex_internal_context',
	'external_codex_apps_open_page',
	'turn_aborted',
	'transcript_delta',
	'skill',
	'image',
	'source',
]

const dropped = new RegExp(
	`<(${droppedTags.join('|')})(\\s[^>]*)?>[\\s\\S]*?(</\\1>|$)|<(${droppedTags.join('|')})(\\s[^>]*)?/>`,
	'g',
)

/** Messages that are harness text from start to finish, recognised by how they open. */
const injectedOpenings = [
	'Caveat:',
	'# AGENTS.md instructions',
	'The following is the Codex agent history',
	'[Request interrupted by user',
]

const commandName = /<command-name>\s*([^<]*?)\s*<\/command-name>/

const commandArgs = /<command-args>([\s\S]*?)<\/command-args>/

/** What one user message offers a title. */
export type PromptPiece =
	| { readonly kind: 'prompt'; readonly text: string }
	| { readonly kind: 'command'; readonly name: string }
	| { readonly kind: 'skip' }

const skip: PromptPiece = { kind: 'skip' }

const commandPiece = (text: string): PromptPiece | undefined => {
	const match = commandName.exec(text)

	if (match === null) {
		return undefined
	}

	const name = match[1] ?? ''
	const args = clampTitle(commandArgs.exec(text)?.[1] ?? '')

	if (args !== '') {
		return { kind: 'prompt', text: clampTitle(`${name} ${args}`) }
	}

	return name === '' ? skip : { kind: 'command', name }
}

/**
 * Reads one user message as a title: a typed prompt, a bare slash command, or nothing. Pasted text
 * and replies keep their content; `<bash-input>` becomes `! command`.
 */
export const readPrompt = (text: string): PromptPiece => {
	const trimmed = text.trimStart()

	if (injectedOpenings.some((opening) => trimmed.startsWith(opening))) {
		return skip
	}

	const command = commandPiece(trimmed)

	if (command !== undefined) {
		return command
	}

	const plain = clampTitle(
		trimmed
			.replaceAll(dropped, ' ')
			.replaceAll(/<bash-input>/g, '! ')
			.replaceAll(/<\/?[A-Za-z][\w-]*(\s[^>]*)?\/?>/g, ' '),
	)

	return plain === '' ? skip : { kind: 'prompt', text: plain }
}

/** Every user text block, in order. */
export const userTexts = (turns: ReadonlyArray<TranscriptTurn>): Array<string> =>
	turns.flatMap((turn) =>
		turn.role === 'user'
			? turn.blocks.flatMap((block) => (block.kind === 'text' ? [block.text] : []))
			: [],
	)

/** Fallback when nobody typed anything: the bare commands that were run, or `empty tape`. */
export const fallbackTitle = (commands: ReadonlyArray<string>): string => {
	const unique = [...new Set(commands)]

	return unique.length === 0 ? 'empty tape' : clampTitle(`${unique.join(' ')} only`)
}

/** A transcript's title fields. */
export interface TitleFields {
	readonly title: string
	readonly titleSource: TitleSource
}

/** The transcript fields for a title. */
export const titleFields = (title: TapeTitle): TitleFields => ({
	title: title.title,
	titleSource: title.source,
})

/** Title from the harness's name, else the first real prompt, else a fallback. */
export const tapeTitle = (name: string | undefined, texts: ReadonlyArray<string>): TapeTitle => {
	const named = clampTitle(name ?? '')

	if (named !== '') {
		return { title: named, source: 'name' }
	}

	const commands: Array<string> = []

	for (const text of texts) {
		const piece = readPrompt(text)

		if (piece.kind === 'prompt') {
			return { title: piece.text, source: 'prompt' }
		}

		if (piece.kind === 'command') {
			commands.push(piece.name)
		}
	}

	return { title: fallbackTitle(commands), source: 'fallback' }
}

/**
 * Records that name a session. Claude Code appends `custom-title` (from `/rename`) and `ai-title`
 * (generated) lines as it goes, and older versions wrote `summary` lines. Pi appends `session_info`
 * lines with a `name`; an empty name clears it.
 */
const NameRecord = Schema.Struct({
	type: Schema.String,
	customTitle: Schema.optionalKey(Schema.String),
	aiTitle: Schema.optionalKey(Schema.String),
	summary: Schema.optionalKey(Schema.String),
	name: Schema.optionalKey(Schema.String),
})

type NameRecord = Schema.Schema.Type<typeof NameRecord>

const latest = (
	records: ReadonlyArray<NameRecord>,
	type: string,
	pick: (record: NameRecord) => string | undefined,
): string | undefined => {
	const found = records.findLast((record) => record.type === type)

	return found === undefined ? undefined : (pick(found)?.trim() ?? '')
}

const nonEmpty = (value: string | undefined): string | undefined =>
	value === undefined || value === '' ? undefined : value

const claudeName = (records: ReadonlyArray<NameRecord>): string | undefined =>
	nonEmpty(latest(records, 'custom-title', (record) => record.customTitle)) ??
	nonEmpty(latest(records, 'ai-title', (record) => record.aiTitle)) ??
	nonEmpty(latest(records, 'summary', (record) => record.summary))

/**
 * The harness's own name for a session, from its jsonl lines (latest wins). Codex keeps names
 * outside the session file, in `session_index.jsonl`; see `codexThreadNames`.
 */
export const harnessName = (harness: Harness, lines: ReadonlyArray<string>): string | undefined => {
	if (harness === 'codex') {
		return undefined
	}

	const records = decodeJsonLines(NameRecord, lines)

	return harness === 'pi'
		? nonEmpty(latest(records, 'session_info', (record) => record.name))
		: claudeName(records)
}

const IndexEntry = Schema.Struct({ id: Schema.String, thread_name: Schema.String })

/**
 * Codex thread names from `$CODEX_HOME/session_index.jsonl`, which Codex appends to on `/rename`
 * and when it names a thread. Later lines win, as in Codex.
 */
export const codexThreadNames = (lines: ReadonlyArray<string>): Map<string, string> => {
	const names = new Map<string, string>()

	for (const entry of decodeJsonLines(IndexEntry, lines)) {
		names.set(entry.id.toLowerCase(), entry.thread_name.trim())
	}

	return names
}
