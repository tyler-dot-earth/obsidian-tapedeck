import { readFileSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Result } from 'effect'

import { splitThread, type ThreadLine } from '#/src/tapedeck-claude-thread'
import { type RenderOptions, renderTranscriptNote } from '#/src/tapedeck-render'
import { claudeCodeSource } from '#/src/tapedeck-source-claude-code'
import type { Transcript, TranscriptTurn } from '#/src/tapedeck-transcript'

const parsed = (name: string): Transcript =>
	Result.getOrThrow(
		claudeCodeSource.parse(readFileSync(`fixtures/claude-code-branches/${name}.jsonl`, 'utf8')),
	)

const options: RenderOptions = {
	foldToolCalls: true,
	toolOutput: 'full',
	truncateLines: 40,
	includeThinking: false,
	showAbandonedBranches: false,
	noteStyle: 'raw',
	machine: undefined,
	resume: 'claude --resume x',
	importedAt: new Date('2026-02-01T12:00:00.000Z'),
	redactHome: undefined,
	redactSecrets: false,
	previous: { created: undefined, project: undefined },
}

const texts = (turns: ReadonlyArray<TranscriptTurn>): Array<string> =>
	turns.flatMap((turn) =>
		turn.blocks.flatMap((block) => (block.kind === 'text' ? [block.text] : [])),
	)

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1

describe('Claude Code active branch', () => {
	it('drops turns the user rewound past and keeps the live ones in order', () => {
		const transcript = parsed('rewind')

		assert.deepStrictEqual(texts(transcript.turns), [
			'Add a rec-light that blinks while recording.',
			'Added a blinking rec-light to the deck.',
			'Keep the blink, but add a rewind-button next to it.',
			'Added the rewind-button beside the rec-light.',
		])
	})

	it('keeps an answered rewound branch, placed after the turn it branched off', () => {
		const [branch, ...rest] = parsed('rewind').abandoned

		assert.lengthOf(rest, 0)
		assert.strictEqual(branch?.after, 2)
		assert.deepStrictEqual(texts(branch?.turns ?? []), [
			'Make the rec-light pulse slowly instead.',
			'The rec-light now pulses on a two-second loop.',
			'Also dim it while paused.',
			'Dimmed the rec-light while paused.',
		])
	})

	it('drops an interrupted prompt that was sent again', () => {
		const transcript = parsed('interrupt-resend')
		const note = renderTranscriptNote(transcript, { ...options, showAbandonedBranches: true })

		assert.lengthOf(transcript.abandoned, 0)
		assert.strictEqual(occurrences(note, 'Now rename side-b to flip-side'), 1)
		assert.include(note, 'including the README.')
		assert.notInclude(note, 'Request interrupted')
		assert.include(note, 'Renamed side-b to flip-side in 2 files.')
	})

	it('keeps parallel tool calls and their results with their turn', () => {
		const transcript = parsed('parallel-tools')

		const outputs = transcript.turns.flatMap((turn) =>
			turn.blocks.flatMap((block) => (block.kind === 'tool' ? [block.output] : [])),
		)

		assert.deepStrictEqual(outputs, ['{ "heads": 2 }', 'mixtape\nside-b'])
		assert.include(texts(transcript.turns), 'The deck has 2 heads and 2 cassettes.')
		assert.include(texts(transcript.turns), 'Glad to help.')
		assert.lengthOf(transcript.abandoned, 0)
	})

	it('follows the thread across a compaction', () => {
		const transcript = parsed('compaction')

		assert.strictEqual(texts(transcript.turns)[0], 'Sketch the boombox layout.')
		assert.include(texts(transcript.turns), 'Added a rec-light above the left door.')
		assert.lengthOf(transcript.abandoned, 0)
		assert.strictEqual(transcript.title, 'Sketch the boombox layout.')
	})

	it('treats lines without ids as one live thread', () => {
		const lines: Array<ThreadLine & { readonly name: string }> = [{ name: 'a' }, { name: 'b' }]

		const split = splitThread(
			lines,
			() => true,
			() => true,
		)

		assert.deepStrictEqual(
			split.live.map((line) => line.name),
			['a', 'b'],
		)
		assert.lengthOf(split.dead, 0)
	})

	it('stops when parent links loop', () => {
		const lines: Array<ThreadLine> = [
			{ uuid: 'side-b', parentUuid: 'mixtape' },
			{ uuid: 'mixtape', parentUuid: 'side-b' },
		]

		const split = splitThread(
			lines,
			() => true,
			() => true,
		)

		assert.lengthOf(split.live, 2)
	})
})

describe('Show abandoned branches', () => {
	const transcript = parsed('rewind')

	it('leaves rewound turns out when off', () => {
		const note = renderTranscriptNote(transcript, options)

		assert.notInclude(note, 'Abandoned branch')
		assert.notInclude(note, 'pulse slowly')
		assert.notInclude(note, 'Dimmed the rec-light')
	})

	it('folds them into a callout where they branched off when on', () => {
		const note = renderTranscriptNote(transcript, { ...options, showAbandonedBranches: true })
		const callout = note.indexOf('> [!note]- ⏪ Abandoned branch · 2 turns · Jan 15 08:44')

		assert.isAbove(callout, note.indexOf('Added a blinking rec-light to the deck.'))
		assert.isBelow(callout, note.indexOf('## 🗣️ User · 08:50'))
		assert.include(note, '> **🗣️ User · 08:44**\n>\n> Make the rec-light pulse slowly instead.')
		assert.include(note, '> > [!example]- tool: Edit')
		assert.include(note, '> **🤖 Assistant · 08:47**\n>\n> Dimmed the rec-light while paused.')
		assert.notInclude(note, '## 🗣️ User · 08:44')
	})
})
