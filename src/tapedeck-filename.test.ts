import { assert, describe, it } from '@effect/vitest'

import { sanitizeFilename, transcriptFilename } from '#/src/tapedeck-filename'
import type { Transcript } from '#/src/tapedeck-transcript'

const transcript: Transcript = {
	harness: 'codex',
	sessionId: 'abcdef12-0000-0000-0000-000000000000',
	model: undefined,
	cwd: undefined,
	startedAt: '2026-03-04T05:06:07.000Z',
	title: 'Fix: the [flaky] test?',
	turns: [],
}

describe('transcriptFilename', () => {
	it('fills tokens and strips unsafe characters', () => {
		assert.strictEqual(
			transcriptFilename('{date} {time} {harness} {session} {title}', transcript, new Date(0)),
			'2026-03-04 0506 codex abcdef12 Fix the flaky test',
		)
	})

	it('falls back to the default pattern when empty', () => {
		assert.strictEqual(
			transcriptFilename('  ', transcript, new Date(0)),
			'2026-03-04 codex Fix the flaky test',
		)
	})

	it('never returns an empty name', () => {
		assert.strictEqual(sanitizeFilename('///'), 'transcript')
	})
})
