import { Option, Result, Schema } from 'effect'

import { newFileDiff, replacementDiff } from '#/src/tapedeck-diff'
import { TapedeckParseError } from '#/src/tapedeck-errors'
import {
	decodeJsonLines,
	someLineMatches,
	prettyJson,
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
 * Claude Code writes one JSON object per line to `~/.claude/projects/<encoded cwd>/<session
 * id>.jsonl`. Lines of type `user` and `assistant` carry an Anthropic Messages API `message`.
 * Assistant content is split across lines, one content block each.
 */
const ClaudeBlock = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
	thinking: Schema.optionalKey(Schema.String),
	name: Schema.optionalKey(Schema.String),
	id: Schema.optionalKey(Schema.String),
	input: Schema.optionalKey(Schema.Json),
	tool_use_id: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(TextContent),
	is_error: Schema.optionalKey(Schema.Boolean),
})

type ClaudeBlock = Schema.Schema.Type<typeof ClaudeBlock>

const ClaudeLine = Schema.Struct({
	type: Schema.String,
	sessionId: Schema.optionalKey(Schema.String),
	cwd: Schema.optionalKey(Schema.String),
	timestamp: Schema.optionalKey(Schema.String),
	isMeta: Schema.optionalKey(Schema.Boolean),
	isSidechain: Schema.optionalKey(Schema.Boolean),
	message: Schema.optionalKey(
		Schema.Struct({
			role: Schema.optionalKey(Schema.String),
			model: Schema.optionalKey(Schema.String),
			content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(ClaudeBlock)])),
		}),
	),
})

type ClaudeLine = Schema.Schema.Type<typeof ClaudeLine>

const EditInput = Schema.Struct({
	file_path: Schema.String,
	old_string: Schema.optionalKey(Schema.String),
	new_string: Schema.optionalKey(Schema.String),
	content: Schema.optionalKey(Schema.String),
	edits: Schema.optionalKey(
		Schema.Array(Schema.Struct({ old_string: Schema.String, new_string: Schema.String })),
	),
})

type EditInput = Schema.Schema.Type<typeof EditInput>

const decodeEditInput = Schema.decodeUnknownOption(EditInput)

const editDiff = (input: EditInput): string | undefined => {
	if (input.old_string !== undefined && input.new_string !== undefined) {
		return replacementDiff(input.file_path, input.old_string, input.new_string)
	}

	if (input.edits !== undefined) {
		return input.edits
			.map((edit) => replacementDiff(input.file_path, edit.old_string, edit.new_string))
			.join('\n')
	}

	return input.content === undefined ? undefined : newFileDiff(input.file_path, input.content)
}

const toolDiff = (input: Schema.Json): string | undefined =>
	Option.match(decodeEditInput(input), {
		onNone: () => undefined,
		onSome: editDiff,
	})

const collectResults = (lines: ReadonlyArray<ClaudeLine>): Map<string, ToolResult> => {
	const results = new Map<string, ToolResult>()

	for (const block of lines.flatMap(contentBlocks)) {
		if (block.type === 'tool_result' && block.tool_use_id !== undefined) {
			results.set(block.tool_use_id, {
				output: textOf(block.content),
				isError: block.is_error ?? false,
				diff: undefined,
			})
		}
	}

	return results
}

const contentBlocks = (line: ClaudeLine): ReadonlyArray<ClaudeBlock> => {
	const content = line.message?.content

	return content === undefined || Schema.is(Schema.String)(content) ? [] : content
}

const proseBlock = (block: ClaudeBlock): Array<TranscriptBlock> => {
	if (block.type === 'text' && block.text !== undefined) {
		return [{ kind: 'text', text: block.text }]
	}

	if (block.type === 'thinking' && block.thinking !== undefined && block.thinking !== '') {
		return [{ kind: 'thinking', text: block.thinking }]
	}

	return []
}

const toBlock = (block: ClaudeBlock, results: Map<string, ToolResult>): Array<TranscriptBlock> => {
	if (block.type !== 'tool_use') {
		return proseBlock(block)
	}

	const result = results.get(block.id ?? '')
	const input = block.input ?? {}

	return [
		{
			kind: 'tool',
			name: block.name ?? 'tool',
			input: prettyJson(input),
			diff: toolDiff(input),
			output: result?.output,
			isError: result?.isError ?? false,
		},
	]
}

const lineBlocks = (
	line: ClaudeLine,
	results: Map<string, ToolResult>,
): ReadonlyArray<TranscriptBlock> => {
	const content = line.message?.content

	if (content === undefined) {
		return []
	}

	if (Schema.is(Schema.String)(content)) {
		return content.trim() === '' ? [] : [{ kind: 'text', text: content }]
	}

	return content.flatMap((block) => toBlock(block, results))
}

const isConversationLine = (line: ClaudeLine): boolean =>
	(line.type === 'user' || line.type === 'assistant') &&
	line.isMeta !== true &&
	line.isSidechain !== true

const firstDefined = (values: ReadonlyArray<string | undefined>): string | undefined =>
	values.find((value) => value !== undefined && value !== '' && value !== '<synthetic>')

const parse = (text: string): Result.Result<Transcript, TapedeckParseError> => {
	const lines = decodeJsonLines(ClaudeLine, jsonLines(text)).filter(isConversationLine)
	const sessionId = firstDefined(lines.map((line) => line.sessionId))

	if (sessionId === undefined) {
		return Result.fail(new TapedeckParseError({ message: 'No Claude Code messages found' }))
	}

	const results = collectResults(lines)
	const turns: Array<TranscriptTurn> = []

	for (const line of lines) {
		appendTurn(turns, {
			role: line.type === 'user' ? 'user' : 'assistant',
			timestamp: line.timestamp,
			blocks: lineBlocks(line, results),
		})
	}

	return Result.succeed({
		harness: 'claude-code',
		sessionId,
		model: firstDefined(lines.map((line) => line.message?.model)),
		cwd: firstDefined(lines.map((line) => line.cwd)),
		startedAt: firstDefined(lines.map((line) => line.timestamp)),
		title: titleFromTurns(turns),
		turns,
	})
}

const DetectLine = Schema.Struct({ sessionId: Schema.String, type: Schema.String })

/** Claude Code `~/.claude/projects/<project>/<session-id>.jsonl`. */
export const claudeCodeSource: TranscriptSource = {
	harness: 'claude-code',
	label: 'Claude Code',
	emoji: '🟠',
	defaultDirectory: ['.claude', 'projects'],
	matchesFile: (relativePath) => /^[^/]+\/[^/]+\.jsonl$/.test(relativePath),
	detect: (headLines) => someLineMatches(DetectLine, headLines),
	parse,
	resumeCommand: (transcript) =>
		transcript.cwd === undefined
			? `claude --resume ${transcript.sessionId}`
			: `cd ${JSON.stringify(transcript.cwd)} && claude --resume ${transcript.sessionId}`,
}
