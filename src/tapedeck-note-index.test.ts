import { assert, describe, it } from '@effect/vitest'

import { ChangeSignal, NoteIndex } from '#/src/tapedeck-note-index'

interface FakeFile {
	path: string
}

describe('NoteIndex', () => {
	it('updates one note at a time and reports only real changes', () => {
		const index = new NoteIndex<FakeFile>()
		const note: FakeFile = { path: 'Transcripts/side-b.md' }
		const other: FakeFile = { path: 'Notes/rec-light.md' }

		assert.isTrue(index.set(note, 'pi\u0000a'))
		assert.isFalse(index.set(note, 'pi\u0000a'))
		assert.isFalse(index.set(other, undefined))
		assert.strictEqual(index.get('pi\u0000a'), note)

		note.path = 'Archive/side-b.md'
		assert.isTrue(index.has(note))
		assert.strictEqual(index.get('pi\u0000a')?.path, 'Archive/side-b.md')

		assert.isTrue(index.set(note, 'pi\u0000b'))
		assert.isUndefined(index.get('pi\u0000a'))
		assert.isTrue(index.set(note, undefined))
		assert.isFalse(index.has(note))
	})

	it('forgets deleted notes, keeping a newer note with the same session', () => {
		const index = new NoteIndex<FakeFile>()
		const first: FakeFile = { path: 'a.md' }
		const second: FakeFile = { path: 'b.md' }

		index.set(first, 'codex\u0000x')
		index.set(second, 'codex\u0000x')
		assert.isTrue(index.remove(first))
		assert.strictEqual(index.get('codex\u0000x'), second)
		assert.isFalse(index.remove(first))
	})
})

describe('ChangeSignal', () => {
	it('calls listeners until they unsubscribe', () => {
		const signal = new ChangeSignal()
		let calls = 0

		const off = signal.on(() => {
			calls += 1
		})

		signal.trigger()
		off()
		signal.trigger()
		assert.strictEqual(calls, 1)
	})
})
