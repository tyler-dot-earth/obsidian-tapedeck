import { Option, Result, Schema } from 'effect'

import { TapedeckParseError } from '#/src/tapedeck-errors'
import {
	decodeJsonLines,
	someLineMatches,
	prettyJsonString,
	TextContent,
	textOf,
} from '#/src/tapedeck-json'
import {
	appendTurn,
	jsonLines,
	titleFromTurns,
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
const CodexPayload = Schema.Struct({
	type: Schema.optionalKey(Schema.String),
	id: Schema.optionalKey(Schema.String),
	cwd: Schema.optionalKey(Schema.String),
	model: Schema.optionalKey(Schema.String),
	timestamp: Schema.optionalKey(Schema.String),
	role: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.NullOr(TextContent)),
	summary: Schema.optionalKey(TextContent),
	name: Schema.optionalKey(Schema.String),
	arguments: Schema.optionalKey(Schema.String),
	input: Schema.optionalKey(Schema.String),
	call_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	output: Schema.optionalKey(TextContent),
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

const outputText = (output: TextContent | undefined): string => {
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
		output: result?.output,
		isError: result?.isError ?? false,
	}
}

const toolTypes = new Set(['function_call', 'custom_tool_call', 'local_shell_call'])

const messageTurn = (line: CodexLine): TranscriptTurn | undefined => {
	const { payload } = line
	const text = textOf(payload.content ?? undefined)

	if (payload.role === 'user' && !isInjected(text)) {
		return { role: 'user', timestamp: line.timestamp, blocks: [{ kind: 'text', text }] }
	}

	if (payload.role === 'assistant') {
		return { role: 'assistant', timestamp: line.timestamp, blocks: [{ kind: 'text', text }] }
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
		title: titleFromTurns(turns),
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
