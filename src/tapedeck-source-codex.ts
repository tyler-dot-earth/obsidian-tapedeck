import { Option, Result, Schema } from 'effect'

import { TapedeckParseError } from '#/src/tapedeck-errors'
import { imageBlock, imageFromUrl, placeLabelledImages } from '#/src/tapedeck-images'
import {
	decodeJsonLines,
	someLineMatches,
	prettyJsonString,
	TextContent,
	textOf,
} from '#/src/tapedeck-json'
import { tapeTitle, titleFields, userTexts } from '#/src/tapedeck-tape-title'
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
 * Codex CLI writes `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. Each line is `{
 * timestamp, type, payload }`. `session_meta` opens the file, `turn_context` names the model, and
 * `response_item` holds Responses API items (`message`, `reasoning`, `function_call`,
 * `function_call_output`, `custom_tool_call`, ...).
 */
/** Responses API content item: `input_text`, `output_text`, or `input_image` (data URL or file id). */
const CodexPart = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
	image_url: Schema.optionalKey(Schema.String),
	file_id: Schema.optionalKey(Schema.String),
})

type CodexPart = Schema.Schema.Type<typeof CodexPart>

const CodexContent = Schema.Union([Schema.String, Schema.Array(CodexPart)])

type CodexContent = Schema.Schema.Type<typeof CodexContent>

const CodexPayload = Schema.Struct({
	type: Schema.optionalKey(Schema.String),
	id: Schema.optionalKey(Schema.String),
	cwd: Schema.optionalKey(Schema.String),
	/** Set on subagent and review threads Codex starts from another thread. */
	parent_thread_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	model: Schema.optionalKey(Schema.String),
	timestamp: Schema.optionalKey(Schema.String),
	role: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.NullOr(CodexContent)),
	summary: Schema.optionalKey(TextContent),
	name: Schema.optionalKey(Schema.String),
	arguments: Schema.optionalKey(Schema.String),
	input: Schema.optionalKey(Schema.String),
	call_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	output: Schema.optionalKey(CodexContent),
	action: Schema.optionalKey(
		Schema.Struct({ command: Schema.optionalKey(Schema.Array(Schema.String)) }),
	),
})

type CodexPayload = Schema.Schema.Type<typeof CodexPayload>

const CodexLine = Schema.Struct({
	timestamp: Schema.optionalKey(Schema.String),
	type: Schema.String,
	payload: CodexPayload,
})

type CodexLine = Schema.Schema.Type<typeof CodexLine>

/** Older rollouts wrap tool output as a JSON string `{ output, metadata }`. */
const WrappedOutput = Schema.fromJsonString(Schema.Struct({ output: Schema.String }))

const ShellArguments = Schema.fromJsonString(
	Schema.Struct({ command: Schema.Array(Schema.String) }),
)

/** Text the harness injects as a user message, not something the user typed. */
const injectedPrefixes = [
	'<environment_context>',
	'<user_instructions>',
	'<permissions instructions>',
	'<user_shell_command>',
	'# AGENTS.md instructions',
]

const isInjected = (text: string): boolean =>
	injectedPrefixes.some((prefix) => text.trimStart().startsWith(prefix))

const outputText = (output: CodexContent | undefined): string => {
	const text = textOf(output)

	return Option.match(Schema.decodeUnknownOption(WrappedOutput)(text), {
		onNone: () => text,
		onSome: (wrapped) => wrapped.output,
	})
}

const isOutputItem = (payload: CodexPayload): boolean =>
	payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output'

const collectResults = (lines: ReadonlyArray<CodexLine>): Map<string, ToolResult> => {
	const results = new Map<string, ToolResult>()

	for (const { payload } of lines) {
		if (isOutputItem(payload)) {
			results.set(payload.call_id ?? '', {
				output: outputText(payload.output),
				isError: false,
				diff: undefined,
				images: partsOf(payload.output).flatMap((part) =>
					part.type === 'input_image' ? [codexImageSource(part, undefined)] : [],
				),
			})
		}
	}

	return results
}

/** Apply_patch arrives as a custom tool input or as `shell` argv `["apply_patch", patch]`. */
const patchOf = (payload: CodexPayload): string | undefined => {
	if (payload.name === 'apply_patch' && payload.input !== undefined) {
		return payload.input
	}

	return Option.match(Schema.decodeUnknownOption(ShellArguments)(payload.arguments ?? ''), {
		onNone: () => undefined,
		onSome: ({ command }) => (command[0] === 'apply_patch' ? command[1] : undefined),
	})
}

const resultFor = (
	payload: CodexPayload,
	results: Map<string, ToolResult>,
): ToolResult | undefined => results.get(payload.call_id ?? '')

const toolInput = (payload: CodexPayload): string => {
	if (payload.arguments !== undefined) {
		return prettyJsonString(payload.arguments)
	}

	return payload.input ?? (payload.action?.command ?? []).join(' ')
}

const toolBlock = (payload: CodexPayload, results: Map<string, ToolResult>): TranscriptBlock => {
	const result = resultFor(payload, results)

	return {
		kind: 'tool',
		name: payload.name ?? payload.type ?? 'tool',
		input: toolInput(payload),
		diff: patchOf(payload),
		...toolResultFields(result),
	}
}

const toolTypes = new Set(['function_call', 'custom_tool_call', 'local_shell_call'])

const partsOf = (content: CodexContent | null | undefined): ReadonlyArray<CodexPart> => {
	if (content === undefined || content === null) {
		return []
	}

	return Schema.is(Schema.String)(content) ? [{ type: 'input_text', text: content }] : content
}

/**
 * A local image arrives as `<image name=[Image #1] path="...">`, the `input_image`, then
 * `</image>`. Pasted images use a bare `<image>`. The tags are not prose.
 */
const localImageTag = /^<image name=(\[Image #\d+\]) path="(.*)">$/s

interface PendingImage {
	readonly label: string
	readonly path: string
	used: boolean
}

/** Where a Codex image's bytes are: an inline data URL, else the local path it came from. */
const codexImageSource = (part: CodexPart, pending: PendingImage | undefined): ImageSource => {
	if (part.image_url !== undefined) {
		return imageFromUrl(part.image_url)
	}

	if (pending !== undefined) {
		return { kind: 'file', path: pending.path }
	}

	return {
		kind: 'missing',
		reason: part.file_id === undefined ? 'no image data' : 'image was uploaded, not stored',
	}
}

/** A tagged local image whose data never followed: fall back to the path. */
const unusedPending = (pending: PendingImage | undefined): Array<TranscriptBlock> =>
	pending === undefined || pending.used
		? []
		: [imageBlock({ kind: 'file', path: pending.path }, pending.label)]

/** The local image tag a message is inside, while its parts are read. */
interface TagState {
	pending: PendingImage | undefined
}

const tagBlocks = (text: string, state: TagState): Array<TranscriptBlock> | undefined => {
	const open = localImageTag.exec(text.trim())

	if (open !== null) {
		const flushed = unusedPending(state.pending)
		state.pending = { label: open[1] ?? '', path: open[2] ?? '', used: false }

		return flushed
	}

	if (text.trim() === '</image>') {
		const flushed = unusedPending(state.pending)
		state.pending = undefined

		return flushed
	}

	return text.trim() === '<image>' ? [] : undefined
}

/** Text and images of one message, in order, with images placed at their `[Image #N]`. */
const messageBlocks = (content: CodexContent | null | undefined): Array<TranscriptBlock> => {
	const state: TagState = { pending: undefined }

	const blocks = partsOf(content).flatMap((part): Array<TranscriptBlock> => {
		if (part.type === 'input_image') {
			const { pending } = state

			if (pending !== undefined) {
				pending.used = true
			}

			return [imageBlock(codexImageSource(part, pending), pending?.label)]
		}

		const text = part.text ?? ''

		return tagBlocks(text, state) ?? [{ kind: 'text', text }]
	})

	return placeLabelledImages([...blocks, ...unusedPending(state.pending)])
}

const messageTurn = (line: CodexLine): TranscriptTurn | undefined => {
	const { payload } = line
	const text = textOf(payload.content ?? undefined)

	if (payload.role === 'user' && !isInjected(text)) {
		return { role: 'user', timestamp: line.timestamp, blocks: messageBlocks(payload.content) }
	}

	if (payload.role === 'assistant') {
		return { role: 'assistant', timestamp: line.timestamp, blocks: messageBlocks(payload.content) }
	}

	return undefined
}

const itemTurn = (
	line: CodexLine,
	results: Map<string, ToolResult>,
): TranscriptTurn | undefined => {
	const { payload } = line

	if (payload.type === 'message') {
		return messageTurn(line)
	}

	if (payload.type === 'reasoning') {
		const text = textOf(payload.summary)
		const blocks: Array<TranscriptBlock> = text === '' ? [] : [{ kind: 'thinking', text }]

		return { role: 'assistant', timestamp: line.timestamp, blocks }
	}

	if (toolTypes.has(payload.type ?? '')) {
		return { role: 'assistant', timestamp: line.timestamp, blocks: [toolBlock(payload, results)] }
	}

	return undefined
}

const itemTurns = (items: ReadonlyArray<CodexLine>): Array<TranscriptTurn> => {
	const results = collectResults(items)
	const turns: Array<TranscriptTurn> = []

	for (const line of items) {
		const turn = itemTurn(line, results)

		if (turn !== undefined) {
			appendTurn(turns, turn)
		}
	}

	return turns
}

const lastDefined = (values: ReadonlyArray<string | undefined>): string | undefined =>
	values.findLast((value) => value !== undefined && value !== '')

const parse = (text: string): Result.Result<Transcript, TapedeckParseError> => {
	const lines = decodeJsonLines(CodexLine, jsonLines(text))
	const meta = lines.find((line) => line.type === 'session_meta')?.payload

	if (meta?.id === undefined) {
		return Result.fail(new TapedeckParseError({ message: 'No Codex session_meta line found' }))
	}

	const turns = itemTurns(lines.filter((line) => line.type === 'response_item'))

	const contexts = lines.filter((line) => line.type === 'turn_context')

	return Result.succeed({
		harness: 'codex',
		sessionId: meta.id,
		model: lastDefined(contexts.map((line) => line.payload.model)),
		cwd: meta.cwd ?? lastDefined(contexts.map((line) => line.payload.cwd)),
		startedAt: meta.timestamp ?? lines[0]?.timestamp,
		...titleFields(tapeTitle(undefined, userTexts(turns))),
		subagent: meta.parent_thread_id !== undefined && meta.parent_thread_id !== null,
		turns,
	})
}

const DetectLine = Schema.Struct({
	type: Schema.Literal('session_meta'),
	payload: Schema.Struct({ id: Schema.String }),
})

/** Codex CLI `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. */
export const codexSource: TranscriptSource = {
	harness: 'codex',
	label: 'Codex CLI',
	emoji: '🔷',
	defaultDirectory: ['.codex', 'sessions'],
	matchesFile: (relativePath) => /(^|\/)rollout-[^/]+\.jsonl$/.test(relativePath),
	detect: (headLines) => someLineMatches(DetectLine, headLines),
	parse,
	resumeCommand: (transcript) => `codex resume ${transcript.sessionId}`,
}
