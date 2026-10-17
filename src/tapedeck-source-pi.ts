import { Option, Result, Schema } from 'effect'

import { newFileDiff } from '#/src/tapedeck-diff'
import { TapedeckParseError } from '#/src/tapedeck-errors'
import { imageBlock } from '#/src/tapedeck-images'
import { decodeJsonLines, prettyJson, someLineMatches, TextPart, textOf } from '#/src/tapedeck-json'
import { harnessName, tapeTitle, titleFields, userTexts } from '#/src/tapedeck-tape-title'
import {
	appendTurn,
	type ImageSource,
	jsonLines,
	toolResultFields,
	type ToolResult,
	type Transcript,
	type TranscriptBlock,
	type TranscriptSource,
	type TranscriptTurn,
} from '#/src/tapedeck-transcript'

/**
 * Pi (pi-mono coding agent) writes `~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl`. Line one is
 * the `session` header. Later entries form a tree through `id` / `parentId`; the active branch runs
 * from the last entry back to the root.
 */
const PiPart = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
	thinking: Schema.optionalKey(Schema.String),
	id: Schema.optionalKey(Schema.String),
	name: Schema.optionalKey(Schema.String),
	arguments: Schema.optionalKey(Schema.Json),
	/** Image parts (`type: "image"`): base64 bytes and their MIME type. */
	data: Schema.optionalKey(Schema.String),
	mimeType: Schema.optionalKey(Schema.String),
})

type PiPart = Schema.Schema.Type<typeof PiPart>

const PiMessage = Schema.Struct({
	role: Schema.String,
	content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(PiPart)])),
	model: Schema.optionalKey(Schema.String),
	toolCallId: Schema.optionalKey(Schema.String),
	isError: Schema.optionalKey(Schema.Boolean),
	details: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				diff: Schema.optionalKey(Schema.String),
				patch: Schema.optionalKey(Schema.String),
			}),
		),
	),
	command: Schema.optionalKey(Schema.String),
	output: Schema.optionalKey(Schema.String),
})

type PiMessage = Schema.Schema.Type<typeof PiMessage>

const PiEntry = Schema.Struct({
	type: Schema.String,
	id: Schema.optionalKey(Schema.String),
	parentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
	timestamp: Schema.optionalKey(Schema.String),
	cwd: Schema.optionalKey(Schema.String),
	modelId: Schema.optionalKey(Schema.String),
	summary: Schema.optionalKey(Schema.String),
	message: Schema.optionalKey(PiMessage),
})

type PiEntry = Schema.Schema.Type<typeof PiEntry>

const WriteArguments = Schema.Struct({ path: Schema.String, content: Schema.String })

const partsText = (content: PiMessage['content']): string =>
	textOf(
		content === undefined || Schema.is(Schema.String)(content)
			? content
			: content.filter(Schema.is(TextPart)),
	)

/** Walks the active branch: last entry back to the root through `parentId`. */
const parentOf = (entry: PiEntry, byId: Map<string, PiEntry>): PiEntry | undefined =>
	entry.parentId === undefined || entry.parentId === null ? undefined : byId.get(entry.parentId)

/** Walks the active branch: last entry back to the root through `parentId`. */
const activeBranch = (entries: ReadonlyArray<PiEntry>): ReadonlyArray<PiEntry> => {
	let current = entries.at(-1)

	if (current?.id === undefined) {
		return entries
	}

	const byId = new Map(
		entries.flatMap((entry) => (entry.id === undefined ? [] : [[entry.id, entry] as const])),
	)

	const branch: Array<PiEntry> = []

	while (current !== undefined && branch.length <= entries.length) {
		branch.push(current)
		current = parentOf(current, byId)
	}

	return branch.toReversed()
}

/** Where a Pi image's bytes are. Pi stores them inline as `{ type: "image", data, mimeType }`. */
const piImageSource = (part: PiPart): ImageSource =>
	part.data === undefined
		? { kind: 'missing', reason: 'the session file does not include the image data' }
		: { kind: 'inline', mimeType: part.mimeType ?? 'image/png', base64: part.data }

const contentParts = (content: PiMessage['content']): ReadonlyArray<PiPart> => {
	const parts = content ?? []

	return Schema.is(Schema.String)(parts) ? [{ type: 'text', text: parts }] : parts
}

const toolResultOf = (message: PiMessage): ToolResult => ({
	output: partsText(message.content),
	isError: message.isError ?? false,
	diff: message.details?.patch ?? message.details?.diff,
	images: contentParts(message.content).flatMap((part) =>
		part.type === 'image' ? [piImageSource(part)] : [],
	),
})

/** User text and images in order. Pi does not add `[Image #N]` placeholders. */
const userBlocks = (content: PiMessage['content']): Array<TranscriptBlock> =>
	contentParts(content).flatMap((part): Array<TranscriptBlock> => {
		if (part.type === 'image') {
			return [imageBlock(piImageSource(part), undefined)]
		}

		return part.text === undefined || part.text.trim() === ''
			? []
			: [{ kind: 'text', text: part.text }]
	})

const collectResults = (entries: ReadonlyArray<PiEntry>): Map<string, ToolResult> => {
	const results = new Map<string, ToolResult>()

	for (const entry of entries) {
		const message = entry.message

		if (message?.role === 'toolResult') {
			results.set(message.toolCallId ?? '', toolResultOf(message))
		}
	}

	return results
}

const writeDiff = (input: Schema.Json): string | undefined => {
	return Option.match(Schema.decodeUnknownOption(WriteArguments)(input), {
		onNone: () => undefined,
		onSome: (write) => newFileDiff(write.path, write.content),
	})
}

const prosePart = (part: PiPart): Array<TranscriptBlock> => {
	if (part.type === 'text' && part.text !== undefined) {
		return [{ kind: 'text', text: part.text }]
	}

	if (part.type === 'thinking' && part.thinking !== undefined && part.thinking !== '') {
		return [{ kind: 'thinking', text: part.thinking }]
	}

	return []
}

const writeDiffFor = (name: string, input: Schema.Json): string | undefined =>
	name === 'write' ? writeDiff(input) : undefined

const toolCallBlock = (part: PiPart, result: ToolResult | undefined): TranscriptBlock => {
	const input = part.arguments ?? {}
	const name = part.name ?? 'tool'

	return {
		kind: 'tool',
		name,
		input: prettyJson(input),
		diff: result?.diff ?? writeDiffFor(name, input),
		...toolResultFields(result),
	}
}

const partBlock = (part: PiPart, results: Map<string, ToolResult>): Array<TranscriptBlock> => {
	if (part.type !== 'toolCall') {
		return prosePart(part)
	}

	return [toolCallBlock(part, results.get(part.id ?? ''))]
}

const bashBlock = (message: PiMessage): TranscriptBlock => ({
	kind: 'tool',
	name: 'bash (user)',
	input: message.command ?? '',
	diff: undefined,
	output: message.output,
	isError: false,
	images: [],
})

const messageBlocks = (
	message: PiMessage,
	results: Map<string, ToolResult>,
): ReadonlyArray<TranscriptBlock> => {
	switch (message.role) {
		case 'user':
			return userBlocks(message.content)
		case 'assistant':
			return contentParts(message.content).flatMap((part) => partBlock(part, results))
		case 'bashExecution':
			return [bashBlock(message)]
		default:
			return []
	}
}

const messageTurn = (
	entry: PiEntry,
	message: PiMessage,
	results: Map<string, ToolResult>,
): TranscriptTurn => ({
	role: message.role === 'assistant' ? 'assistant' : 'user',
	timestamp: entry.timestamp,
	blocks: messageBlocks(message, results),
})

const summaryTurn = (entry: PiEntry): TranscriptTurn | undefined => {
	if (entry.summary === undefined) {
		return undefined
	}

	const title = entry.type === 'compaction' ? 'Compaction summary' : 'Branch summary'

	return {
		role: 'assistant',
		timestamp: entry.timestamp,
		blocks: [{ kind: 'note', title, text: entry.summary }],
	}
}

const entryTurn = (entry: PiEntry, results: Map<string, ToolResult>): TranscriptTurn | undefined =>
	entry.type === 'message' && entry.message !== undefined
		? messageTurn(entry, entry.message, results)
		: summaryTurn(entry)

const parse = (text: string): Result.Result<Transcript, TapedeckParseError> => {
	const raw = jsonLines(text)
	const entries = decodeJsonLines(PiEntry, raw)
	const header = entries.find((entry) => entry.type === 'session')

	if (header?.id === undefined) {
		return Result.fail(new TapedeckParseError({ message: 'No Pi session header found' }))
	}

	const branch = activeBranch(entries.filter((entry) => entry.type !== 'session'))
	const results = collectResults(branch)
	const turns: Array<TranscriptTurn> = []

	for (const entry of branch) {
		const turn = entryTurn(entry, results)

		if (turn !== undefined) {
			appendTurn(turns, turn)
		}
	}

	const models = [...branch, header].flatMap((entry) => [entry.message?.model, entry.modelId])

	return Result.succeed({
		harness: 'pi',
		sessionId: header.id,
		model: models.find((model) => model !== undefined && model !== ''),
		cwd: header.cwd,
		startedAt: header.timestamp,
		...titleFields(tapeTitle(harnessName('pi', raw), userTexts(turns))),
		subagent: false,
		turns,
	})
}

const DetectLine = Schema.Struct({ type: Schema.Literal('session'), id: Schema.String })

/**
 * Pi `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<session-id>.jsonl`. The default folder is
 * `getSessionsDir()` in pi's `packages/coding-agent/src/config.ts` (`<home>/.pi/agent/sessions`),
 * also stated in its `docs/sessions.md`. Pi users can move it with `--session-dir`,
 * `PI_CODING_AGENT_SESSION_DIR`, or the `sessionDir` setting; add a tape shelf for that folder.
 */
export const piSource: TranscriptSource = {
	harness: 'pi',
	label: 'Pi',
	emoji: '🥧',
	defaultDirectory: ['.pi', 'agent', 'sessions'],
	matchesFile: (relativePath) => /^[^/]+\/[^/]+\.jsonl$/.test(relativePath),
	detect: (headLines) => someLineMatches(DetectLine, headLines.slice(0, 1)),
	parse,
	resumeCommand: (transcript) =>
		transcript.cwd === undefined
			? `pi --session ${transcript.sessionId}`
			: `cd ${JSON.stringify(transcript.cwd)} && pi --session ${transcript.sessionId}`,
}
