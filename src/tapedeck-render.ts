import { localDateTime, localTime, parseTimestamp } from '#/src/tapedeck-filename'
import { redactHomePaths, redactSecrets } from '#/src/tapedeck-redact'
import type {
	AbandonedBranch,
	ImageSource,
	ToolBlock,
	Transcript,
	TranscriptBlock,
	TranscriptTurn,
} from '#/src/tapedeck-transcript'

export type ToolOutputMode = 'full' | 'truncated' | 'none'

export type NoteStyle = 'raw' | 'summary'

/** How a transcript becomes a note. */
export interface RenderOptions {
	readonly foldToolCalls: boolean
	readonly toolOutput: ToolOutputMode
	readonly truncateLines: number
	readonly includeThinking: boolean
	/** Put answered branches the user rewound past in a folded callout where they branched off. */
	readonly showAbandonedBranches: boolean
	readonly noteStyle: NoteStyle
	/** Computer name for the `machine` property; undefined leaves the property out. */
	readonly machine: string | undefined
	readonly resume: string
	readonly importedAt: Date
	/** Home directory to rewrite as `~`. Undefined leaves paths alone. */
	readonly redactHome: string | undefined
	readonly redactSecrets: boolean
	/** Values kept from an earlier import of the same session. */
	readonly previous: PreviousNote
}

/** Frontmatter a re-import keeps instead of overwriting. */
export interface PreviousNote {
	readonly created: string | undefined
	readonly project: string | undefined
}

/** Fence long enough that the content cannot close it early. */
const fenceFor = (content: string): string => {
	const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length))

	return '`'.repeat(Math.max(3, longest + 1))
}

const codeBlock = (language: string, content: string): string => {
	const fence = fenceFor(content)

	return `${fence}${language}\n${content.replace(/\n+$/, '')}\n${fence}`
}

const quoted = (text: string): string =>
	text
		.split('\n')
		.map((line) => (line === '' ? '>' : `> ${line}`))
		.join('\n')

const truncate = (text: string, lines: number): string => {
	const all = text.split('\n')

	if (all.length <= lines) {
		return text
	}

	return `${all.slice(0, lines).join('\n')}\n… ${all.length - lines} more lines`
}

const toolOutput = (block: ToolBlock, options: RenderOptions): string | undefined => {
	if (block.output === undefined || block.output === '' || options.toolOutput === 'none') {
		return undefined
	}

	return options.toolOutput === 'truncated'
		? truncate(block.output, options.truncateLines)
		: block.output
}

const toolInput = (block: ToolBlock): string | undefined => {
	const input = block.input.trim()

	if (input === '' || input === '{}' || input === block.diff?.trim()) {
		return undefined
	}

	return codeBlock(/^[[{]/.test(input) ? 'json' : 'text', input)
}

/**
 * An image: the embed when it was saved to the vault, a link when it is remote, otherwise a short
 * note saying why it is not there, using the harness's own label when it had one.
 */
export const renderImage = (source: ImageSource, label: string | undefined): string => {
	const name = label ?? 'Image'

	switch (source.kind) {
		case 'vault':
			return source.embed
		case 'url':
			return `[🖼️ ${name}](${source.url})`
		case 'missing':
			return `*⏸️ ${name} not imported: ${source.reason}*`
		case 'inline':
		case 'file':
			return `*⏸️ ${name} not imported*`
	}

	return `*⏸️ ${name} not imported*`
}

const toolImages = (block: ToolBlock, options: RenderOptions): string | undefined =>
	block.images.length === 0 || options.toolOutput === 'none'
		? undefined
		: block.images.map((image) => renderImage(image, undefined)).join('\n\n')

const renderTool = (block: ToolBlock, options: RenderOptions): string => {
	const fold = options.foldToolCalls ? '-' : '+'
	const callout = block.isError ? 'failure' : 'example'
	const output = toolOutput(block, options)

	const parts = [
		`[!${callout}]${fold} tool: ${block.name}${block.isError ? ' (error)' : ''}`,
		toolInput(block),
		block.diff === undefined ? undefined : codeBlock('diff', block.diff),
		output === undefined ? undefined : codeBlock('text', output),
		toolImages(block, options),
	]

	return quoted(parts.filter((part) => part !== undefined).join('\n\n'))
}

const renderBlock = (block: TranscriptBlock, options: RenderOptions): string | undefined => {
	switch (block.kind) {
		case 'text':
			return block.text.trim() === '' ? undefined : block.text.trim()
		case 'thinking':
			return options.includeThinking
				? quoted(`[!quote]- thinking\n${block.text.trim()}`)
				: undefined
		case 'note':
			return quoted(`[!abstract]- ${block.title}\n${block.text.trim()}`)
		case 'tool':
			return renderTool(block, options)
		case 'image':
			return renderImage(block.source, block.label)
	}

	return undefined
}

const toolSummary = (blocks: ReadonlyArray<TranscriptBlock>): string | undefined => {
	const names = blocks.flatMap((block) => (block.kind === 'tool' ? [block.name] : []))

	if (names.length === 0) {
		return undefined
	}

	const counts = new Map<string, number>()

	for (const name of names) {
		counts.set(name, (counts.get(name) ?? 0) + 1)
	}

	const list = [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))

	return `*📼 ${names.length} tool call${names.length > 1 ? 's' : ''}: ${list.join(', ')}*`
}

const turnLabel = (turn: TranscriptTurn): string => {
	const time = parseTimestamp(turn.timestamp)
	const label = turn.role === 'user' ? '🗣️ User' : '🤖 Assistant'

	return time === undefined ? label : `${label} · ${localTime(time)}`
}

const turnHeading = (turn: TranscriptTurn): string => `## ${turnLabel(turn)}`

const renderTurn = (
	turn: TranscriptTurn,
	options: RenderOptions,
	heading: (turn: TranscriptTurn) => string = turnHeading,
): string | undefined => {
	const summary = options.noteStyle === 'summary' && turn.role === 'assistant'
	const visible = summary ? turn.blocks.filter((block) => block.kind !== 'tool') : turn.blocks
	const bodies = visible.map((block) => renderBlock(block, options))
	const tools = summary ? toolSummary(turn.blocks) : undefined
	const parts = [...bodies, tools].filter((part) => part !== undefined)

	return parts.length === 0 ? undefined : [heading(turn), ...parts].join('\n\n')
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `⏪ Abandoned branch · 2 turns · Oct 16 08:44`, counting the prompts on the branch. */
const branchTitle = (branch: AbandonedBranch): string => {
	const prompts = branch.turns.filter((turn) => turn.role === 'user').length
	const time = parseTimestamp(branch.turns[0]?.timestamp)
	const count = `${prompts} turn${prompts === 1 ? '' : 's'}`

	const when =
		time === undefined ? '' : ` · ${months[time.getMonth()]} ${time.getDate()} ${localTime(time)}`

	return `⏪ Abandoned branch · ${count}${when}`
}

/** A folded callout with a branch's turns, headed in bold so they stay out of the outline. */
const renderBranch = (branch: AbandonedBranch, options: RenderOptions): string => {
	const turns = branch.turns.flatMap(
		(turn) => renderTurn(turn, options, (shown) => `**${turnLabel(shown)}**`) ?? [],
	)

	return quoted([`[!note]- ${branchTitle(branch)}`, turns.join('\n\n')].join('\n'))
}

/** Rendered branches that sit after the first `after` live turns. */
const branchesAfter = (
	transcript: Transcript,
	after: number,
	options: RenderOptions,
): Array<string> =>
	options.showAbandonedBranches
		? transcript.abandoned
				.filter((branch) => branch.after === after)
				.map((branch) => renderBranch(branch, options))
		: []

const yamlString = (value: string | undefined): string =>
	value === undefined || value === '' ? '' : ` ${JSON.stringify(value)}`

const frontmatter = (transcript: Transcript, options: RenderOptions): string => {
	const started = parseTimestamp(transcript.startedAt)
	const importedAt = localDateTime(options.importedAt)

	const lines = [
		'---',
		'type: transcript',
		`harness: ${transcript.harness}`,
		`model:${yamlString(transcript.model)}`,
		`session_id:${yamlString(transcript.sessionId)}`,
		...(options.machine === undefined ? [] : [`machine:${yamlString(options.machine)}`]),
		`cwd:${yamlString(transcript.cwd)}`,
		`resume:${yamlString(options.resume)}`,
		`date:${started === undefined ? '' : ` ${localDateTime(started)}`}`,
		`created: ${options.previous.created ?? importedAt}`,
		...(options.previous.created === undefined ? [] : [`updated: ${importedAt}`]),
		`project:${yamlString(options.previous.project)}`,
		'---',
	]

	return lines.join('\n')
}

/** Renders a transcript as a full note: frontmatter, title, then turns. */
export const renderTranscriptNote = (transcript: Transcript, options: RenderOptions): string => {
	const turns = [
		...branchesAfter(transcript, 0, options),
		...transcript.turns.flatMap((turn, index) => {
			const rendered = renderTurn(turn, options)

			return [
				...(rendered === undefined ? [] : [rendered]),
				...branchesAfter(transcript, index + 1, options),
			]
		}),
	]

	const note = [
		frontmatter(transcript, options),
		'',
		`# 📼 ${transcript.title}`,
		'',
		...turns.flatMap((turn) => [turn, '']),
	].join('\n')

	const homeSafe =
		options.redactHome === undefined ? note : redactHomePaths(note, options.redactHome)

	return options.redactSecrets ? redactSecrets(homeSafe) : homeSafe
}
