import { assert, describe, it } from '@effect/vitest'

import { mapWithLimit } from '#/src/tapedeck-concurrency'
import {
	allShownSelected,
	clearShown,
	filterTapes,
	type ImportedNote,
	importButtonText,
	moveActive,
	projectFromCwd,
	projectFromFolder,
	selectedTapes,
	selectShown,
	sessionIdFromPath,
	type TapeRow,
	tapeLabel,
	tapeState,
	toggleTape,
} from '#/src/tapedeck-tape-list'

const row = (path: string, overrides: Partial<TapeRow>): TapeRow => ({
	path,
	harness: 'claude-code',
	emoji: '🟠',
	agent: 'Claude Code',
	shelf: 'Claude Code',
	modifiedAt: new Date('2026-01-15T09:00:00.000Z'),
	project: 'demo',
	worktree: undefined,
	title: 'Make the greeting say hello world',
	kind: 'session',
	sessionId: undefined,
	state: 'new',
	notePath: undefined,
	...overrides,
})

const rows: ReadonlyArray<TapeRow> = [
	row('a.jsonl', {}),
	row('b.jsonl', {
		harness: 'codex',
		agent: 'Codex CLI',
		shelf: 'Work laptop',
		project: 'billing-api',
		title: 'Fix the flaky invoice test',
		modifiedAt: new Date('2026-02-03T14:30:00.000Z'),
	}),
	row('c.jsonl', { project: undefined, title: undefined }),
]

describe('project names', () => {
	it('takes the last folder of a cwd', () => {
		assert.strictEqual(projectFromCwd('/home/sample/projects/demo'), 'demo')
		assert.strictEqual(projectFromCwd('/home/sample/projects/demo/'), 'demo')
		assert.strictEqual(projectFromCwd('C:\\Users\\sample\\code\\my-app'), 'my-app')
		assert.isUndefined(projectFromCwd('C:\\'))
		assert.isUndefined(projectFromCwd('/'))
		assert.isUndefined(projectFromCwd(undefined))
	})

	it('strips the encoded home folder from Claude Code and Pi folder names', () => {
		assert.strictEqual(
			projectFromFolder('-home-sample-projects-demo', '/home/sample'),
			'projects-demo',
		)
		assert.strictEqual(
			projectFromFolder('--home-sample-projects-demo--', '/home/sample'),
			'projects-demo',
		)
		assert.strictEqual(
			projectFromFolder('C--Users-sample-code-app', 'C:\\Users\\sample'),
			'code-app',
		)
		assert.strictEqual(projectFromFolder('-srv-tapes', '/home/sample'), 'srv-tapes')

		assert.strictEqual(
			projectFromFolder('-home-sample--work-trees-app', '/home/sample'),
			'work-trees-app',
		)
		assert.isUndefined(projectFromFolder('-home-sample-', '/home/sample'))
	})
})

describe('filterTapes', () => {
	it('keeps every row, in order, for an empty query', () => {
		assert.deepStrictEqual(
			filterTapes(rows, '  ').map((tape) => tape.path),
			['a.jsonl', 'b.jsonl', 'c.jsonl'],
		)
	})

	it('matches every word against agent, shelf, project, prompt, and date', () => {
		const paths = (query: string): Array<string> =>
			filterTapes(rows, query).map((tape) => tape.path)

		assert.deepStrictEqual(paths('BILLING'), ['b.jsonl'])
		assert.deepStrictEqual(paths('flaky invoice'), ['b.jsonl'])
		assert.deepStrictEqual(paths('work laptop'), ['b.jsonl'])
		assert.deepStrictEqual(paths('codex'), ['b.jsonl'])
		assert.deepStrictEqual(paths('2026-01-15'), ['a.jsonl', 'c.jsonl'])
		assert.deepStrictEqual(paths('demo greeting'), ['a.jsonl'])
		assert.deepStrictEqual(paths('demo invoice'), [])
	})

	it('labels rows with emoji, date, project, prompt, and an imported mark', () => {
		assert.strictEqual(
			tapeLabel(rows[0] ?? row('x', {})),
			'🟠 2026-01-15 09:00 · demo · Make the greeting say hello world',
		)
		assert.strictEqual(
			tapeLabel(row('d', { project: undefined, title: undefined, state: 'imported' })),
			'🟠 2026-01-15 09:00 · — · reading… · ⏪ in vault',
		)
	})
})

describe('selection', () => {
	it('starts empty and toggles single tapes', () => {
		const one = toggleTape(new Set(), 'a.jsonl')
		assert.deepStrictEqual([...one], ['a.jsonl'])
		assert.deepStrictEqual([...toggleTape(one, 'a.jsonl')], [])
	})

	it('selects and clears only the shown rows', () => {
		const shown = filterTapes(rows, 'demo')
		const kept = selectShown(new Set(['b.jsonl']), shown)
		assert.deepStrictEqual(kept, new Set(['a.jsonl', 'b.jsonl']))
		assert.isTrue(allShownSelected(kept, shown))
		assert.deepStrictEqual([...clearShown(kept, shown)], ['b.jsonl'])
		assert.isFalse(allShownSelected(kept, []))
	})

	it('imports selected rows in list order', () => {
		const selection = new Set(['c.jsonl', 'a.jsonl'])
		assert.deepStrictEqual(
			selectedTapes(rows, selection).map((tape) => tape.path),
			['a.jsonl', 'c.jsonl'],
		)
		assert.strictEqual(importButtonText(0), 'Import 0 tapes')
		assert.strictEqual(importButtonText(1), 'Import 1 tape')
		assert.strictEqual(importButtonText(12), 'Import 12 tapes')
	})

	it('moves the highlight within the list', () => {
		assert.strictEqual(moveActive(-1, 1, 3), 0)
		assert.strictEqual(moveActive(2, 1, 3), 2)
		assert.strictEqual(moveActive(0, -1, 3), 0)
		assert.strictEqual(moveActive(1, 10, 3), 2)
		assert.strictEqual(moveActive(0, 1, 0), -1)
	})
})

describe('mapWithLimit', () => {
	it('keeps order and never runs more than the limit at once', async () => {
		let running = 0
		let peak = 0

		const results = await mapWithLimit([5, 1, 4, 2, 3], 2, async (value) => {
			running += 1
			peak = Math.max(peak, running)
			await new Promise((resolve) => setTimeout(resolve, value))
			running -= 1

			return value * 10
		})

		assert.deepStrictEqual(results, [50, 10, 40, 20, 30])
		assert.strictEqual(peak, 2)
		assert.deepStrictEqual(await mapWithLimit([], 4, async (value: number) => value), [])
	})
})

const modifiedAt = new Date('2026-01-15T09:00:00.000Z')

const note = (importedAt: string | undefined): ImportedNote => ({
	path: 'T/x.md',
	importedAt: importedAt === undefined ? undefined : new Date(importedAt),
})

describe('tapeState', () => {
	it('is unknown without a session id and new without a note', () => {
		assert.strictEqual(tapeState(undefined, modifiedAt, note(undefined)), 'unknown')
		assert.strictEqual(tapeState('s', modifiedAt, undefined), 'new')
	})

	it('is changed only when the file moved on after the import', () => {
		assert.strictEqual(tapeState('s', modifiedAt, note('2026-01-15T10:00:00.000Z')), 'imported')
		assert.strictEqual(tapeState('s', modifiedAt, note('2026-01-15T08:59:30.000Z')), 'imported')
		assert.strictEqual(tapeState('s', modifiedAt, note('2026-01-15T08:00:00.000Z')), 'changed')
		assert.strictEqual(tapeState('s', modifiedAt, note(undefined)), 'imported')
	})

	it('reads the session id from each harness file name', () => {
		const id = '11111111-2222-4333-8444-555555555555'
		assert.strictEqual(sessionIdFromPath(`/p/-home-x/${id}.jsonl`), id)
		assert.strictEqual(sessionIdFromPath(`/p/2026/rollout-2026-01-15T10-00-00-${id}.jsonl`), id)
		assert.strictEqual(sessionIdFromPath(`/p/--x--/2026-01-15T11-00-00-000Z_${id}.jsonl`), id)
		assert.isUndefined(sessionIdFromPath('/p/notes.jsonl'))
	})
})
