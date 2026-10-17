import {
	isInVault,
	isListed,
	searchTapes,
	type TapeRow,
	type TapeState,
} from '#/src/tapedeck-tape-list'

/** Pure pieces of the tape rack sidebar: filtering, grouping, and the flat list it draws. */

/** How the rack groups its rows. */
export type RackGrouping = 'none' | 'project' | 'shelf'

/** Grouping for a rack opened for the first time. */
export const defaultRackGrouping: RackGrouping = 'project'

/** Labels for the grouping dropdown. */
export const rackGroupingLabels: Record<RackGrouping, string> = {
	none: 'No groups',
	project: 'By project',
	shelf: 'By shelf',
}

/**
 * Rows matching the search, minus unlisted tapes and, when hidden, tapes already in the vault. Rows
 * in `kept` (just imported or failed) stay put until the next refresh or filter change, so a row
 * never vanishes under the pointer.
 */
export const rackTapes = (
	rows: ReadonlyArray<TapeRow>,
	query: string,
	hideInVault: boolean,
	kept: ReadonlySet<string> = new Set(),
): Array<TapeRow> =>
	searchTapes(rows, query).filter(
		(row) => kept.has(row.path) || (isListed(row) && !(hideInVault && isInVault(row))),
	)

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

/** Whether every group shown is folded. */
export const allFolded = (
	groups: ReadonlyArray<RackGroup>,
	collapsed: ReadonlySet<string>,
): boolean => groups.length > 0 && groups.every((group) => collapsed.has(group.key))

/** The fold-all button: expands everything when all groups are folded, else folds them all. */
export const toggleAllFolds = (
	groups: ReadonlyArray<RackGroup>,
	collapsed: ReadonlySet<string>,
): ReadonlySet<string> =>
	allFolded(groups, collapsed) ? new Set() : new Set(groups.map((group) => group.key))

/**
 * What clicking a row does: open the note when there is one, otherwise show a preview. A click
 * never imports; the preview and the row button do that.
 */
export const rowClickAction = (row: TapeRow): 'open' | 'preview' =>
	isInVault(row) && row.notePath !== undefined ? 'open' : 'preview'

/** How importing one tape went. */
export type TapeImportResult =
	| {
			readonly path: string
			readonly ok: true
			readonly notePath: string
			readonly title: string
			readonly updated: boolean
	  }
	| { readonly path: string; readonly ok: false; readonly message: string }

/** What a row shows after an import from the rack, until the next refresh. */
export type RowOutcome =
	| { readonly kind: 'importing' }
	| { readonly kind: 'imported'; readonly notePath: string; readonly updated: boolean }
	| { readonly kind: 'failed'; readonly message: string }

/** Row outcome for an import result. */
export const rowOutcome = (result: TapeImportResult): RowOutcome =>
	result.ok
		? { kind: 'imported', notePath: result.notePath, updated: result.updated }
		: { kind: 'failed', message: result.message }

/** Badge text for an outcome. */
export const outcomeBadges: Record<RowOutcome['kind'], string> = {
	importing: 'importing…',
	imported: 'imported ✓',
	failed: 'import failed',
}

/** "📼 Tapedeck: 3 new, 1 updated, 1 failed." for a batch import. */
export const importSummary = (results: ReadonlyArray<TapeImportResult>): string => {
	const updated = results.filter((result) => result.ok && result.updated).length
	const failed = results.filter((result) => !result.ok).length
	const created = results.length - updated - failed
	const failures = failed > 0 ? `, ${failed} failed` : ''

	return `📼 Tapedeck: ${created} new, ${updated} updated${failures}.`
}

/**
 * Holds redraws while the pointer is down on the list. Redrawing replaces row elements, and a click
 * whose press and release land on different elements never fires, so redraws that arrive mid-click
 * (titles streaming in, a refresh when the rack gains focus) wait for the release.
 */
export class RenderGate {
	private held = false
	private pending = false

	/** The pointer went down on the list. */
	hold(): void {
		this.held = true
	}

	/** The pointer came up. Returns whether a redraw was asked for meanwhile. */
	release(): boolean {
		const pending = this.pending
		this.held = false
		this.pending = false

		return pending
	}

	/** Asks to redraw now. Returns false, and remembers the ask, while held. */
	request(): boolean {
		if (this.held) {
			this.pending = true

			return false
		}

		return true
	}
}

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
