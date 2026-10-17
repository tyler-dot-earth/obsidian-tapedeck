import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, assert, beforeAll, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { defaultTapeShelves } from '#/src/tapedeck-shelves'
import { TapeInfoCache, tapeRow } from '#/src/tapedeck-tape-info'

let home = ''

const nothingImported = (): boolean => false

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
		const row = tapeRow(claude, undefined, nothingImported, home)
		assert.strictEqual(row.project, 'home-sample-projects-demo')
		assert.isUndefined(row.title)
		assert.isUndefined(tapeRow(codex, undefined, nothingImported, home).project)
	})

	it('fills the first prompt and cwd project from the first chunk', async () => {
		const cache = new TapeInfoCache()
		const pi = await byHarness('pi')
		const info = await cache.read(pi)
		const row = tapeRow(pi, info, nothingImported, home)
		assert.strictEqual(row.project, 'demo')
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

		const row = tapeRow(
			claude,
			info,
			(harness, sessionId) =>
				harness === 'claude-code' && sessionId === '11111111-2222-4333-8444-555555555555',
			home,
		)

		assert.isTrue(row.imported)
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
