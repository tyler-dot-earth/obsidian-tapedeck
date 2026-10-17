import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, assert, beforeAll, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { defaultTapeShelves } from '#/src/tapedeck-shelves'
import { decodeTapeCache, encodeTapeCache } from '#/src/tapedeck-tape-cache-file'
import { TapeInfoCache, tapeRow } from '#/src/tapedeck-tape-info'
import type { ImportedNote } from '#/src/tapedeck-tape-list'

let home = ''

const nothingImported = (): undefined => undefined

const files = (): Promise<ReadonlyArray<SessionFile>> =>
	Effect.runPromise(listSessionFiles(defaultTapeShelves, home))

const byHarness = async (harness: string): Promise<SessionFile> => {
	const found = (await files()).find((file) => file.source.harness === harness)
	assert.isDefined(found)

	return found ?? Promise.reject(new Error(harness))
}

/** Synthetic Codex tape whose first line is bigger than the first read. */
const bigCodexTape = (): string => {
	const meta = {
		timestamp: '2026-03-01T08:00:00.000Z',
		type: 'session_meta',
		payload: {
			id: '019a0000-eeee-7fff-8000-111111111111',
			timestamp: '2026-03-01T08:00:00.000Z',
			cwd: '/home/sample/projects/big-repo',
			instructions: 'x'.repeat(100_000),
		},
	}

	const prompt = {
		timestamp: '2026-03-01T08:00:01.000Z',
		type: 'response_item',
		payload: {
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text: 'Rename the big module' }],
		},
	}

	return `${JSON.stringify(meta)}\n${JSON.stringify(prompt)}\n`
}

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), 'tapedeck-info-'))
	cpSync('fixtures/claude-code', join(home, '.claude', 'projects'), { recursive: true })
	cpSync('fixtures/pi', join(home, '.pi', 'agent', 'sessions'), { recursive: true })

	const day = join(home, '.codex', 'sessions', '2026', '03', '01')
	mkdirSync(day, { recursive: true })

	writeFileSync(
		join(day, 'rollout-2026-03-01T08-00-00-019a0000-eeee-7fff-8000-111111111111.jsonl'),
		bigCodexTape(),
	)
})

afterAll(() => {
	rmSync(home, { recursive: true, force: true })
})

describe('tape rows', () => {
	it('guesses the project from the folder before the tape is read', async () => {
		const claude = await byHarness('claude-code')
		const codex = await byHarness('codex')
		const row = tapeRow(claude, undefined, nothingImported, { home })
		assert.strictEqual(row.project, 'home-sample-projects-mixtape')
		assert.isUndefined(row.title)
		assert.isUndefined(tapeRow(codex, undefined, nothingImported, { home }).project)
	})

	it('fills the first prompt and cwd project from the first chunk', async () => {
		const cache = new TapeInfoCache()
		const pi = await byHarness('pi')
		const info = await cache.read(pi)
		const row = tapeRow(pi, info, nothingImported, { home })
		assert.strictEqual(row.project, 'mixtape')
		assert.isString(row.title)
		assert.notStrictEqual(row.title, 'unreadable tape')
		assert.strictEqual(info.sessionId, '33333333-4444-4555-8666-777777777777')
	})

	it('reads further when the first line is bigger than the first chunk', async () => {
		const info = await new TapeInfoCache().read(await byHarness('codex'))
		assert.strictEqual(info.title, 'Rename the big module')
		assert.strictEqual(info.cwd, '/home/sample/projects/big-repo')
	})

	it('marks tapes whose session is already in the vault', async () => {
		const claude = await byHarness('claude-code')
		const info = await new TapeInfoCache().read(claude)

		const importedAt = new Date(claude.modifiedAt.getTime() + 1000)

		const lookup = (harness: string, sessionId: string): ImportedNote | undefined =>
			harness === 'claude-code' && sessionId === '11111111-2222-4333-8444-555555555555'
				? { path: 'Transcripts/mixtape.md', importedAt }
				: undefined

		const row = tapeRow(claude, info, lookup, { home })
		assert.strictEqual(row.state, 'imported')
		assert.strictEqual(row.notePath, 'Transcripts/mixtape.md')
		assert.strictEqual(tapeRow(claude, undefined, lookup, { home }).state, 'imported')
	})

	it('knows the session id from the file name before reading', async () => {
		const pi = await byHarness('pi')
		const row = tapeRow(pi, undefined, nothingImported, { home })
		assert.strictEqual(row.sessionId, '33333333-4444-4555-8666-777777777777')
		assert.strictEqual(row.state, 'new')
	})
})

describe('TapeInfoCache', () => {
	it('reuses a read until the file changes', async () => {
		const cache = new TapeInfoCache()
		const claude = await byHarness('claude-code')
		assert.isUndefined(cache.peek(claude))
		const info = await cache.read(claude)
		assert.strictEqual(cache.peek(claude), info)

		const touched = { ...claude, modifiedAt: new Date(claude.modifiedAt.getTime() + 1000) }
		assert.isUndefined(cache.peek(touched))
		assert.isUndefined(cache.peek({ ...claude, size: claude.size + 1 }))
	})

	it('labels a file it cannot parse instead of failing', async () => {
		const claude = await byHarness('claude-code')
		const broken = join(home, 'broken.jsonl')
		writeFileSync(broken, 'not json\n')
		const info = await new TapeInfoCache().read({ ...claude, path: broken, size: 9 })
		assert.strictEqual(info.title, 'unreadable tape')
	})
})

describe('tape cache file', () => {
	it('round-trips what was read, so a restart peeks instead of reading', async () => {
		const pi = await byHarness('pi')
		const first = new TapeInfoCache()
		await first.prepare([pi], home)
		const info = await first.read(pi)
		const text = encodeTapeCache(first.snapshot())

		const second = new TapeInfoCache()
		assert.isUndefined(second.peek(pi))
		second.restore(decodeTapeCache(text))
		assert.deepStrictEqual(second.peek(pi), info)
	})

	it('misses when the tape changed since it was cached', async () => {
		const pi = await byHarness('pi')
		const first = new TapeInfoCache()
		await first.read(pi)

		const second = new TapeInfoCache()
		second.restore(decodeTapeCache(encodeTapeCache(first.snapshot())))
		assert.isUndefined(second.peek({ ...pi, size: pi.size + 1 }))
	})

	it('ignores a missing or damaged file', () => {
		assert.deepStrictEqual(decodeTapeCache(undefined), [])
		assert.deepStrictEqual(decodeTapeCache('{"version":1,"tapes":[{"key":3}]}'), [])
		assert.deepStrictEqual(decodeTapeCache('not json'), [])
		assert.deepStrictEqual(decodeTapeCache('{"version":2,"tapes":[]}'), [])
	})

	it('signals new reads, not cache hits', async () => {
		const pi = await byHarness('pi')
		const cache = new TapeInfoCache()
		let reads = 0

		cache.changed.on(() => {
			reads += 1
		})

		await cache.read(pi)
		await cache.read(pi)
		assert.strictEqual(reads, 1)
	})
})
