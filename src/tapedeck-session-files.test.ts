import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterAll, assert, beforeAll, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { TapedeckReadError } from '#/src/tapedeck-errors'
import { isShelfAvailable, listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { defaultTapeShelves, type TapeShelf } from '#/src/tapedeck-shelves'

/** A throwaway home folder holding the synthetic fixtures where each harness would write them. */
let home = ''

const fixtureFiles = {
	claude:
		'fixtures/claude-code/-home-sample-projects-mixtape/11111111-2222-4333-8444-555555555555.jsonl',
	codex:
		'fixtures/codex/2026/01/15/rollout-2026-01-15T10-00-00-019a0000-aaaa-7bbb-8ccc-dddddddddddd.jsonl',
	pi: 'fixtures/pi/--home-sample-projects-mixtape--/2026-01-15T11-00-00-000Z_33333333-4444-4555-8666-777777777777.jsonl',
}

const shelf = (path: string, harness: TapeShelf['harness']): TapeShelf => ({
	path,
	harness,
	enabled: true,
})

const listed = (
	shelves: ReadonlyArray<TapeShelf>,
): Effect.Effect<ReadonlyArray<string>, TapedeckReadError> =>
	listSessionFiles(shelves, home).pipe(
		Effect.map((files: ReadonlyArray<SessionFile>) =>
			files.map((file) => `${file.source.harness} ${basename(file.path)}`),
		),
	)

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), 'tapedeck-home-'))
	cpSync('fixtures/claude-code', join(home, '.claude', 'projects'), { recursive: true })
	cpSync('fixtures/codex', join(home, '.codex', 'sessions'), { recursive: true })
	cpSync('fixtures/pi', join(home, '.pi', 'agent', 'sessions'), { recursive: true })

	const loose = join(home, 'exports')
	mkdirSync(join(loose, 'mixtape', 'abc', 'subagents'), { recursive: true })
	cpSync(fixtureFiles.claude, join(loose, 'claude.jsonl'))
	cpSync(fixtureFiles.codex, join(loose, 'codex.jsonl'))
	cpSync(fixtureFiles.pi, join(loose, 'pi.jsonl'))
	cpSync(fixtureFiles.claude, join(loose, 'mixtape', 'abc', 'subagents', 'agent.jsonl'))
	writeFileSync(join(loose, 'notes.jsonl'), '{"hello":"world"}\n')
})

afterAll(() => {
	rmSync(home, { recursive: true, force: true })
})

describe('listSessionFiles', () => {
	it.effect('finds one tape per harness on the default shelves', () =>
		Effect.gen(function* () {
			const files = yield* listed(defaultTapeShelves)
			assert.deepStrictEqual(
				new Set(files.map((file) => file.split(' ')[0])),
				new Set(['claude-code', 'codex', 'pi']),
			)

			assert.strictEqual(files.length, 3)
		}),
	)

	it.effect('skips missing and disabled shelves quietly', () =>
		Effect.gen(function* () {
			const missing = shelf('~/no/such/folder', 'claude-code')
			const disabled = { ...shelf('~/.codex/sessions', 'codex'), enabled: false }
			assert.deepStrictEqual(yield* listed([missing, disabled]), [])
			assert.deepStrictEqual(yield* listed([missing, shelf('', 'pi')]), [])
		}),
	)

	it.effect('auto-detects loose files and skips side files and other jsonl', () =>
		Effect.gen(function* () {
			const files = yield* listed([shelf('~/exports', 'auto')])
			assert.deepStrictEqual(
				new Set(files),
				new Set(['claude-code claude.jsonl', 'codex codex.jsonl', 'pi pi.jsonl']),
			)

			assert.strictEqual(files.length, 3)
		}),
	)

	it.effect('lists a file once when shelves overlap', () =>
		Effect.gen(function* () {
			const files = yield* listed([
				shelf('~/.claude/projects', 'claude-code'),
				shelf('~/.claude/projects', 'auto'),
			])

			assert.strictEqual(files.length, 1)
		}),
	)
})

describe('isShelfAvailable', () => {
	it('is true only for a folder that exists', () => {
		assert.isTrue(isShelfAvailable(shelf('~/.pi/agent/sessions', 'pi'), home))
		assert.isFalse(isShelfAvailable(shelf('~/no/such/folder', 'pi'), home))
		assert.isFalse(isShelfAvailable(shelf('~/exports/notes.jsonl', 'auto'), home))
		assert.isFalse(isShelfAvailable(shelf('  ', 'auto'), home))
	})
})
