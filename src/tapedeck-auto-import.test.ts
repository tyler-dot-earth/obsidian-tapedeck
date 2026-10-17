import { assert, describe, it } from '@effect/vitest'
import { memoryPluginDataStoreLayer } from '@tyler.earth/effect-obsidian'
import { Effect } from 'effect'

import {
	AutoImportRunner,
	autoImportIntervalMs,
	autoImportOf,
	isAutoImportCandidate,
	isAutoImportDue,
	withAutoImport,
	withLastRun,
} from '#/src/tapedeck-auto-import'
import {
	loadTapedeckPluginSettings,
	resolveTapedeckSettings,
	withTapeShelves,
} from '#/src/tapedeck-plugin-settings'
import { defaultTapeShelves, type TapeShelf } from '#/src/tapedeck-shelves'
import type { TapeRow } from '#/src/tapedeck-tape-list'

const minute = 60_000

const enabledAt = Date.parse('2026-03-01T12:00:00.000Z')

const plainShelf: TapeShelf = { path: '~/.pi/agent/sessions', harness: 'pi', enabled: true }

const hourly = withAutoImport(plainShelf, 'hourly', enabledAt)

const row = (overrides: Partial<TapeRow>): TapeRow => ({
	path: '/tapes/a.jsonl',
	harness: 'pi',
	emoji: '🥧',
	agent: 'Pi',
	shelf: 'Pi',
	modifiedAt: new Date(enabledAt + minute),
	project: 'demo',
	worktree: undefined,
	title: 'Say hello',
	kind: 'session',
	sessionId: '00000000-0000-4000-8000-000000000001',
	state: 'new',
	notePath: undefined,
	...overrides,
})

const noRun = async (): Promise<void> => undefined

const nothing = (): void => undefined

/** Holds a run open until `open()`, so another tick can arrive mid-run. */
class Gate {
	readonly promise: Promise<void>
	private release: () => void = nothing

	constructor() {
		this.promise = new Promise((done) => {
			this.release = done
		})
	}

	open(): void {
		this.release()
	}
}

describe('auto-import schedule', () => {
	it('is off for shelves saved before auto-import, and for the defaults', () => {
		assert.strictEqual(autoImportOf(plainShelf), 'off')
		assert.isTrue(defaultTapeShelves.every((shelf) => autoImportOf(shelf) === 'off'))
		assert.isFalse(isAutoImportDue(plainShelf, enabledAt + 10 * autoImportIntervalMs.daily))
	})

	it.effect('stays off after loading old settings', () =>
		Effect.gen(function* () {
			const resolved = resolveTapedeckSettings(yield* loadTapedeckPluginSettings)
			assert.isTrue(resolved.tapeShelves.every((shelf) => autoImportOf(shelf) === 'off'))
		}).pipe(
			Effect.provide(
				memoryPluginDataStoreLayer({
					schemaVersion: 1,
					claudeCodeDirectory: '/data/claude',
					tapeShelves: [plainShelf],
				}),
			),
		),
	)

	it('keeps a schedule when settings are saved and loaded', () => {
		const saved = withTapeShelves({}, [hourly])
		assert.deepStrictEqual(resolveTapedeckSettings(saved).tapeShelves, [hourly])

		const scheduledDefaults = defaultTapeShelves.map((shelf, index) =>
			index === 0 ? withAutoImport(shelf, 'daily', enabledAt) : shelf,
		)

		assert.deepStrictEqual(
			resolveTapedeckSettings(withTapeShelves({}, scheduledDefaults)).tapeShelves,
			scheduledDefaults,
		)
	})

	it('stamps the moment it is turned on, keeps it on a frequency change, clears it when off', () => {
		assert.deepStrictEqual(hourly, {
			...plainShelf,
			autoImport: 'hourly',
			autoImportSince: enabledAt,
		})

		const ran = { ...hourly, autoImportLastRun: enabledAt + 2 * autoImportIntervalMs.hourly }
		const daily = withAutoImport(ran, 'daily', enabledAt + 999 * minute)
		assert.strictEqual(daily.autoImportSince, enabledAt)
		assert.strictEqual(daily.autoImportLastRun, ran.autoImportLastRun)
		assert.deepStrictEqual(withAutoImport(ran, 'off', enabledAt), plainShelf)
	})

	it('is due a full interval after it was turned on, then after each run', () => {
		assert.isFalse(isAutoImportDue(hourly, enabledAt + 59 * minute))
		assert.isTrue(isAutoImportDue(hourly, enabledAt + 60 * minute))

		const ran = { ...hourly, autoImportLastRun: enabledAt + 90 * minute }
		assert.isFalse(isAutoImportDue(ran, enabledAt + 120 * minute))
		assert.isTrue(isAutoImportDue(ran, enabledAt + 150 * minute))
		assert.isFalse(isAutoImportDue({ ...ran, enabled: false }, enabledAt + 999 * minute))

		const quarter = withAutoImport(plainShelf, '15m', enabledAt)
		assert.isTrue(isAutoImportDue(quarter, enabledAt + 15 * minute))
	})

	it('stamps the last run only on the shelf that ran', () => {
		const other: TapeShelf = { ...hourly, path: '~/elsewhere' }
		const [first, second] = withLastRun([hourly, other], hourly, enabledAt + 61 * minute)
		assert.strictEqual(first?.autoImportLastRun, enabledAt + 61 * minute)
		assert.strictEqual(second?.autoImportLastRun, undefined)
	})
})

describe('auto-import candidates', () => {
	it('only takes tapes modified after auto-import was turned on', () => {
		assert.isTrue(isAutoImportCandidate(row({}), enabledAt))
		assert.isFalse(isAutoImportCandidate(row({ modifiedAt: new Date(enabledAt) }), enabledAt))
		assert.isFalse(
			isAutoImportCandidate(row({ modifiedAt: new Date(enabledAt - minute) }), enabledAt),
		)
	})

	it('takes new and changed sessions, not imported ones, subagents, or empty files', () => {
		assert.isTrue(isAutoImportCandidate(row({ state: 'changed' }), enabledAt))
		assert.isFalse(isAutoImportCandidate(row({ state: 'imported' }), enabledAt))
		assert.isFalse(isAutoImportCandidate(row({ state: 'unknown' }), enabledAt))
		assert.isFalse(isAutoImportCandidate(row({ kind: 'subagent' }), enabledAt))
		assert.isFalse(isAutoImportCandidate(row({ kind: 'empty' }), enabledAt))
		assert.isFalse(isAutoImportCandidate(row({ kind: undefined }), enabledAt))
	})
})

describe('auto-import runner', () => {
	it.effect('does nothing when no shelf is due', () =>
		Effect.promise(async () => {
			const runner = new AutoImportRunner<string>({
				shelves: () => [plainShelf, hourly],
				runShelf: async () => ['imported'],
				markRun: noRun,
				report: () => assert.fail('nothing should be reported'),
			})

			assert.strictEqual(await runner.tick(enabledAt + minute), 'idle')
		}),
	)

	it.effect('never overlaps runs, and reports once when something was imported', () =>
		Effect.promise(async () => {
			const gate = new Gate()
			const reports: Array<ReadonlyArray<string>> = []
			const marked: Array<number> = []
			let runs = 0

			const runner = new AutoImportRunner<string>({
				shelves: () => [hourly],
				runShelf: async () => {
					runs += 1
					await gate.promise

					return ['imported']
				},
				markRun: async (_shelves, at) => {
					marked.push(at)
				},
				report: (results) => {
					reports.push(results)
				},
			})

			const now = enabledAt + 61 * minute
			const first = runner.tick(now)
			assert.isTrue(runner.isRunning)
			assert.strictEqual(await runner.tick(now + minute), 'busy')
			gate.open()
			assert.strictEqual(await first, 'ran')
			assert.strictEqual(runs, 1)
			assert.deepStrictEqual(marked, [now])
			assert.deepStrictEqual(reports, [['imported']])
			assert.isFalse(runner.isRunning)
		}),
	)

	it.effect('stays quiet when a run imports nothing, and survives a failing shelf', () =>
		Effect.promise(async () => {
			const other: TapeShelf = { ...hourly, path: '~/elsewhere' }
			let reported = 0

			const runner = new AutoImportRunner<string>({
				shelves: () => [hourly, other],
				runShelf: async (shelf) => {
					if (shelf.path === hourly.path) {
						throw new Error('folder vanished')
					}

					return []
				},
				markRun: noRun,
				report: () => {
					reported += 1
				},
			})

			assert.strictEqual(await runner.tick(enabledAt + 61 * minute), 'ran')
			assert.strictEqual(reported, 0)
			assert.isFalse(runner.isRunning)
		}),
	)
})
