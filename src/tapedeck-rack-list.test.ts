import { assert, describe, it } from '@effect/vitest'

import {
	groupTapes,
	rackItems,
	rackSummary,
	rackTapes,
	rowClickAction,
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
	title: 'Make the greeting say hello world',
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

describe('rack rows', () => {
	it('opens notes that exist and imports the rest', () => {
		assert.deepStrictEqual(rows.map(rowClickAction), ['open', 'import', 'open', 'import'])
	})

	it('summarises counts', () => {
		assert.strictEqual(rackSummary(rows), '4 tapes · 1 new · 1 changed')
		assert.strictEqual(rackSummary([]), '0 tapes · 0 new')
	})
})
