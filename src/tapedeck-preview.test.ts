import { assert, describe, it } from '@effect/vitest'

import {
	needsConfirm,
	previewTranscript,
	previewTurns,
	stripFrontmatter,
	turnCount,
} from '#/src/tapedeck-preview'
import type { Transcript, TranscriptTurn } from '#/src/tapedeck-transcript'

const turn = (index: number): TranscriptTurn => ({
	role: index % 2 === 0 ? 'user' : 'assistant',
	timestamp: undefined,
	blocks: [{ kind: 'text', text: `turn ${index}` }],
})

const transcript: Transcript = {
	harness: 'pi',
	sessionId: 's',
	model: undefined,
	cwd: undefined,
	startedAt: undefined,
	title: 'Demo',
	titleSource: 'prompt',
	subagent: false,
	turns: Array.from({ length: 10 }, (_, index) => turn(index)),
}

describe('tape preview', () => {
	it('keeps only the first few turns', () => {
		assert.strictEqual(previewTranscript(transcript).turns.length, previewTurns)
		assert.strictEqual(transcript.turns.length, 10)
	})

	it('drops frontmatter from the rendered note', () => {
		assert.strictEqual(stripFrontmatter('---\ntype: transcript\n---\n\n# 📼 Demo\n'), '# 📼 Demo\n')
		assert.strictEqual(stripFrontmatter('# No frontmatter'), '# No frontmatter')
	})

	it('counts turns, marking a partial read', () => {
		const preview = { title: 'Demo', startedAt: undefined, turns: 12, partial: false, markdown: '' }
		assert.strictEqual(turnCount(preview), '12 turns')
		assert.strictEqual(turnCount({ ...preview, turns: 40, partial: true }), '40+ turns')
		assert.strictEqual(turnCount({ ...preview, turns: 1 }), '1 turn')
	})

	it('asks before importing more than 20 tapes', () => {
		assert.isFalse(needsConfirm(20))
		assert.isTrue(needsConfirm(21))
	})
})
