import { filterTapes, isInVault, type TapeRow, type TapeState } from '#/src/tapedeck-tape-list'

/** Pure pieces of the tape rack sidebar: filtering, grouping, and the flat list it draws. */

/** How the rack groups its rows. */
export type RackGrouping = 'none' | 'project' | 'shelf'

/** Labels for the grouping dropdown. */
export const rackGroupingLabels: Record<RackGrouping, string> = {
	none: 'No groups',
	project: 'By project',
	shelf: 'By shelf',
}

/** Rows matching the search, minus tapes already in the vault when those are hidden. */
export const rackTapes = (
	rows: ReadonlyArray<TapeRow>,
	query: string,
	hideInVault: boolean,
): Array<TapeRow> => {
	const matching = filterTapes(rows, query)

	return hideInVault ? matching.filter((row) => !isInVault(row)) : matching
}

/** One group of rows under a heading. */
export interface RackGroup {
	readonly key: string
	readonly label: string
	readonly rows: ReadonlyArray<TapeRow>
}

const groupKey = (row: TapeRow, by: RackGrouping): string => {
	if (by === 'project') {
		return row.project ?? ''
	}

	return by === 'shelf' ? row.shelf : ''
}

/**
 * Groups rows, keeping newest-first order inside each group. Groups are ordered by their newest
 * tape, so the project you worked on last comes first. Tapes without a project share one group.
 */
export const groupTapes = (rows: ReadonlyArray<TapeRow>, by: RackGrouping): Array<RackGroup> => {
	const groups = new Map<string, Array<TapeRow>>()

	for (const row of rows) {
		const key = groupKey(row, by)
		const group = groups.get(key) ?? []
		group.push(row)
		groups.set(key, group)
	}

	return [...groups].map(([key, members]) => ({
		key,
		label: key === '' ? (by === 'none' ? 'All tapes' : 'No project') : key,
		rows: members,
	}))
}

/** A line the rack draws: a group heading or a tape. */
export type RackItem =
	| { readonly kind: 'group'; readonly group: RackGroup; readonly collapsed: boolean }
	| { readonly kind: 'tape'; readonly row: TapeRow }

/** Flattens groups into drawable lines. Without grouping there are no headings. */
export const rackItems = (
	groups: ReadonlyArray<RackGroup>,
	by: RackGrouping,
	collapsed: ReadonlySet<string>,
): Array<RackItem> =>
	groups.flatMap((group): Array<RackItem> => {
		const tapes = group.rows.map((row): RackItem => ({ kind: 'tape', row }))

		if (by === 'none') {
			return tapes
		}

		const isCollapsed = collapsed.has(group.key)

		return [{ kind: 'group', group, collapsed: isCollapsed }, ...(isCollapsed ? [] : tapes)]
	})

/** What clicking a row does: open the note when there is one, otherwise import the tape. */
export const rowClickAction = (row: TapeRow): 'open' | 'import' =>
	isInVault(row) && row.notePath !== undefined ? 'open' : 'import'

/** Short badge text for a state. */
export const stateBadges: Record<TapeState, string> = {
	unknown: '',
	new: 'new',
	imported: 'in vault',
	changed: 'changed',
}

/** Tooltips for the state badges. */
export const stateTooltips: Record<TapeState, string> = {
	unknown: '',
	new: 'Not imported yet',
	imported: 'Has a note in the vault',
	changed: 'Changed since it was imported',
}

/**
 * "120 tapes · 8 not imported · 3 changed · 40 subagent or empty hidden" for the status line.
 * `unlisted` counts tapes left out of lists (see `isListed`).
 */
export const rackSummary = (rows: ReadonlyArray<TapeRow>, unlisted: number): string => {
	const count = (state: TapeState): number => rows.filter((row) => row.state === state).length
	const changed = count('changed')

	const parts = [
		`${rows.length} ${rows.length === 1 ? 'tape' : 'tapes'}`,
		`${count('new')} not imported`,
		...(changed > 0 ? [`${changed} changed`] : []),
		...(unlisted > 0 ? [`${unlisted} subagent or empty hidden`] : []),
	]

	return parts.join(' · ')
}
