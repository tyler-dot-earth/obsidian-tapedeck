import type { AutoImportEvery, TapeShelf } from '#/src/tapedeck-shelves'
import { isListed, type TapeRow } from '#/src/tapedeck-tape-list'

/** A schedule that runs. */
export type AutoImportSchedule = Exclude<AutoImportEvery, 'off'>

/** Time between runs for each schedule. */
export const autoImportIntervalMs: Readonly<Record<AutoImportSchedule, number>> = {
	'15m': 15 * 60_000,
	'hourly': 60 * 60_000,
	'daily': 24 * 60 * 60_000,
}

/** Labels for the schedule picker, in the order they are offered. */
export const autoImportLabels: Readonly<Record<AutoImportEvery, string>> = {
	'off': 'Off',
	'15m': 'Every 15 minutes',
	'hourly': 'Hourly',
	'daily': 'Daily',
}

/** How often the plugin checks whether a shelf is due, while Obsidian is open. */
export const autoImportTickMs = 60_000

/** A shelf's schedule; shelves saved before auto-import existed are off. */
export const autoImportOf = (shelf: TapeShelf): AutoImportEvery => shelf.autoImport ?? 'off'

/**
 * Whether a shelf should auto-import now: it is on, enabled, and a full interval has passed since
 * its last run (or since it was turned on, before the first run).
 */
export const isAutoImportDue = (shelf: TapeShelf, now: number): boolean => {
	const every = autoImportOf(shelf)

	if (every === 'off' || !shelf.enabled || shelf.autoImportSince === undefined) {
		return false
	}

	const last = shelf.autoImportLastRun ?? shelf.autoImportSince

	return now - last >= autoImportIntervalMs[every]
}

/**
 * Sets a shelf's schedule. Turning it on stamps `autoImportSince` with `now`, so older tapes are
 * never swept in; changing the frequency keeps the stamp; turning it off clears both stamps.
 */
export const withAutoImport = (
	shelf: TapeShelf,
	every: AutoImportEvery,
	now: number,
): TapeShelf => {
	const { autoImport: _autoImport, autoImportSince, autoImportLastRun, ...rest } = shelf

	if (every === 'off') {
		return rest
	}

	if (autoImportOf(shelf) === 'off' || autoImportSince === undefined) {
		return { ...rest, autoImport: every, autoImportSince: now }
	}

	return autoImportLastRun === undefined
		? { ...rest, autoImport: every, autoImportSince }
		: { ...rest, autoImport: every, autoImportSince, autoImportLastRun }
}

/** Whether a file was modified after auto-import was turned on (cheap check before reading it). */
export const isModifiedSince = (modifiedAt: Date, since: number): boolean =>
	modifiedAt.getTime() > since

/**
 * Whether auto-import should import this tape: a session you ran, modified after auto-import was
 * turned on, that is either new or changed since Tapedeck last imported its note.
 */
export const isAutoImportCandidate = (row: TapeRow, since: number): boolean =>
	isModifiedSince(row.modifiedAt, since) &&
	row.kind === 'session' &&
	isListed(row) &&
	(row.state === 'new' || row.state === 'changed')

/** Stamps the last run on the matching shelf (same folder and agent), leaving the rest alone. */
export const withLastRun = (
	shelves: ReadonlyArray<TapeShelf>,
	ran: TapeShelf,
	at: number,
): ReadonlyArray<TapeShelf> =>
	shelves.map((shelf) =>
		shelf.path === ran.path && shelf.harness === ran.harness && autoImportOf(shelf) !== 'off'
			? { ...shelf, autoImportLastRun: at }
			: shelf,
	)

/** One-line description of a shelf's schedule, for settings and the shelf summary. */
export const autoImportText = (shelf: TapeShelf): string | undefined => {
	const every = autoImportOf(shelf)

	return every === 'off' ? undefined : `auto-import ${autoImportLabels[every].toLowerCase()}`
}

/** What one shelf's run did. */
export interface AutoImportRun<R> {
	readonly shelf: TapeShelf
	readonly results: ReadonlyArray<R>
}

/** What the runner needs from the plugin. */
export interface AutoImportHost<R> {
	/** Current shelves from settings. */
	readonly shelves: () => ReadonlyArray<TapeShelf>
	/** Imports this shelf's candidate tapes, returning one result per tape. */
	readonly runShelf: (shelf: TapeShelf) => Promise<ReadonlyArray<R>>
	/** Records that these shelves ran at `at`. */
	readonly markRun: (shelves: ReadonlyArray<TapeShelf>, at: number) => Promise<void>
	/** Reports the results once per tick; called only when some tape was imported or failed. */
	readonly report: (results: ReadonlyArray<R>) => void
}

/** What a tick did: nothing due, skipped because a run was still going, or ran. */
export type AutoImportTick = 'idle' | 'busy' | 'ran'

/**
 * Runs due shelves one after another. A tick while a run is still going is skipped, so runs never
 * overlap; one failing shelf does not stop the others.
 */
export class AutoImportRunner<R> {
	private readonly host: AutoImportHost<R>
	private running = false

	constructor(host: AutoImportHost<R>) {
		this.host = host
	}

	get isRunning(): boolean {
		return this.running
	}

	async tick(now: number): Promise<AutoImportTick> {
		if (this.running) {
			return 'busy'
		}

		const due = this.host.shelves().filter((shelf) => isAutoImportDue(shelf, now))

		if (due.length === 0) {
			return 'idle'
		}

		this.running = true

		try {
			const runs = await this.runAll(due, [])
			await this.host.markRun(due, now)
			const results = runs.flatMap((run) => run.results)

			if (results.length > 0) {
				this.host.report(results)
			}
		} finally {
			this.running = false
		}

		return 'ran'
	}

	private async runAll(
		shelves: ReadonlyArray<TapeShelf>,
		done: ReadonlyArray<AutoImportRun<R>>,
	): Promise<ReadonlyArray<AutoImportRun<R>>> {
		const [shelf, ...rest] = shelves

		if (shelf === undefined) {
			return done
		}

		const results = await this.host.runShelf(shelf).catch((): ReadonlyArray<R> => [])

		return this.runAll(rest, [...done, { shelf, results }])
	}
}
