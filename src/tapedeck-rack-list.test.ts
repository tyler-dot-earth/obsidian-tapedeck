import { assert, describe, it } from '@effect/vitest'

import {
	allFolded,
	importSummary,
	RenderGate,
	rowOutcome,
	type TapeImportResult,
	defaultRackGrouping,
	groupTapes,
	rackItems,
	rackSummary,
	rackTapes,
	rowClickAction,
	toggleAllFolds,
} from '#/src/tapedeck-rack-list'
import type { TapeRow } from '#/src/tapedeck-tape-list'

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
	row('a', { project: 'billing', shelf: 'Work laptop', state: 'changed', notePath: 'T/a.md' }),
	row('b', { project: 'demo' }),
	row('c', { project: 'billing', state: 'imported', notePath: 'T/c.md' }),
	row('d', { project: undefined, state: 'unknown' }),
]

const paths = (list: ReadonlyArray<TapeRow>): Array<string> => list.map((tape) => tape.path)

describe('rack filtering and grouping', () => {
	it('hides tapes already in the vault on request', () => {
		assert.deepStrictEqual(paths(rackTapes(rows, '', false)), ['a', 'b', 'c', 'd'])
		assert.deepStrictEqual(paths(rackTapes(rows, '', true)), ['b', 'd'])
		assert.deepStrictEqual(paths(rackTapes(rows, 'billing', true)), [])
		assert.deepStrictEqual(paths(rackTapes(rows, 'work', false)), ['a'])
	})

	it('groups by project unless the rack was set otherwise', () => {
		assert.strictEqual(defaultRackGrouping, 'project')
	})

	it('groups by project in newest-first order', () => {
		const groups = groupTapes(rows, 'project')
		assert.deepStrictEqual(
			groups.map((group) => [group.label, paths(group.rows)]),
			[
				['billing', ['a', 'c']],
				['demo', ['b']],
				['No project', ['d']],
			],
		)
	})

	it('groups by shelf, or not at all', () => {
		assert.deepStrictEqual(
			groupTapes(rows, 'shelf').map((group) => group.label),
			['Work laptop', 'Claude Code'],
		)

		assert.deepStrictEqual(
			groupTapes(rows, 'none').map((group) => group.label),
			['All tapes'],
		)
	})

	it('flattens groups into headings and rows, skipping collapsed ones', () => {
		const groups = groupTapes(rows, 'project')

		const lines = rackItems(groups, 'project', new Set(['billing'])).map((item) =>
			item.kind === 'group' ? `# ${item.group.label}` : item.row.path,
		)

		assert.deepStrictEqual(lines, ['# billing', '# demo', 'b', '# No project', 'd'])
		assert.strictEqual(rackItems(groupTapes(rows, 'none'), 'none', new Set()).length, 4)
	})
})

const keys = (set: ReadonlySet<string>): Array<string> => [...set]

describe('folding all groups', () => {
	const groups = groupTapes(rows, 'project')

	it('folds every group, then unfolds them', () => {
		const folded = toggleAllFolds(groups, new Set())
		assert.deepStrictEqual(keys(folded), ['billing', 'demo', ''])
		assert.isTrue(allFolded(groups, folded))
		assert.deepStrictEqual(keys(toggleAllFolds(groups, folded)), [])
	})

	it('folds the rest when only some groups are folded', () => {
		const some = new Set(['demo'])
		assert.isFalse(allFolded(groups, some))
		assert.isTrue(allFolded(groups, toggleAllFolds(groups, some)))
	})

	it('treats no groups as not folded', () => {
		assert.isFalse(allFolded([], new Set()))
	})
})

describe('rack rows', () => {
	it('opens notes that exist and imports the rest', () => {
		assert.deepStrictEqual(rows.map(rowClickAction), ['open', 'import', 'open', 'import'])
	})

	it('summarises counts', () => {
		assert.strictEqual(rackSummary(rows, 0), '4 tapes · 1 not imported · 1 changed')
		assert.strictEqual(rackSummary([], 0), '0 tapes · 0 not imported')

		assert.strictEqual(
			rackSummary(rows.slice(1, 2), 3),
			'1 tape · 1 not imported · 3 subagent or empty hidden',
		)
	})
})

describe('importing from the rack', () => {
	it('keeps just-imported rows in place under Hide imported until the marks are dropped', () => {
		assert.deepStrictEqual(paths(rackTapes(rows, '', true)), ['b', 'd'])
		assert.deepStrictEqual(paths(rackTapes(rows, '', true, new Set(['c']))), ['b', 'c', 'd'])
	})

	it('keeps a row that turned out to be a subagent thread after its import', () => {
		const subagent = row('s', { harness: 'codex', kind: 'subagent' })
		assert.deepStrictEqual(paths(rackTapes([subagent], '', false)), [])
		assert.deepStrictEqual(paths(rackTapes([subagent], '', false, new Set(['s']))), ['s'])
	})

	it('waits for unread Codex tapes before listing them', () => {
		const unread = row('u', { harness: 'codex', kind: undefined })
		assert.deepStrictEqual(paths(rackTapes([unread, row('v', { kind: undefined })], '', false)), [
			'v',
		])
	})

	it('reports each result', () => {
		const results: ReadonlyArray<TapeImportResult> = [
			{ path: 'a', ok: true, notePath: 'T/a.md', title: 'A', updated: false },
			{ path: 'b', ok: true, notePath: 'T/b.md', title: 'B', updated: true },
			{ path: 'c', ok: false, message: 'c.jsonl: No Codex session_meta line found' },
		]

		assert.strictEqual(importSummary(results), '📼 Tapedeck: 1 new, 1 updated, 1 failed.')
		assert.strictEqual(importSummary(results.slice(0, 1)), '📼 Tapedeck: 1 new, 0 updated.')

		assert.deepStrictEqual(
			rowOutcome({ path: 'c', ok: false, message: 'c.jsonl: No Codex session_meta line found' }),
			{
				kind: 'failed',
				message: 'c.jsonl: No Codex session_meta line found',
			},
		)
	})
})

describe('RenderGate', () => {
	it('holds redraws while the pointer is down and asks for one on release', () => {
		const gate = new RenderGate()
		assert.isTrue(gate.request())
		gate.hold()
		assert.isFalse(gate.request())
		assert.isTrue(gate.release())
		assert.isTrue(gate.request())
	})

	it('asks for nothing on release when nothing changed', () => {
		const gate = new RenderGate()
		gate.hold()
		assert.isFalse(gate.release())
	})
})
