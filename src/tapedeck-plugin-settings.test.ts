import { assert, describe, it } from '@effect/vitest'
import { memoryPluginDataStoreLayer } from '@tyler.earth/effect-obsidian'
import { Effect } from 'effect'

import {
	tapedeckDefaults,
	defaultTapedeckPluginSettings,
	loadTapedeckPluginSettings,
	resolveTapedeckSettings,
	withTapedeckSetting,
	withTapeShelves,
} from '#/src/tapedeck-plugin-settings'
import { defaultTapeShelves, type TapeShelf } from '#/src/tapedeck-shelves'

const extraShelf: TapeShelf = {
	path: '/srv/tapes',
	label: 'Archive',
	harness: 'auto',
	enabled: true,
}

describe('Tapedeck plugin settings', () => {
	it.effect('uses defaults when plugin data is missing', () =>
		Effect.gen(function* () {
			const settings = yield* loadTapedeckPluginSettings
			assert.deepStrictEqual(settings, defaultTapedeckPluginSettings)
		}).pipe(Effect.provide(memoryPluginDataStoreLayer())),
	)

	it.effect('falls back when stored data is not an object', () =>
		Effect.gen(function* () {
			const settings = yield* loadTapedeckPluginSettings
			assert.deepStrictEqual(settings, defaultTapedeckPluginSettings)
		}).pipe(Effect.provide(memoryPluginDataStoreLayer('nope'))),
	)

	it('fills defaults for missing keys', () => {
		assert.deepStrictEqual(resolveTapedeckSettings({}), tapedeckDefaults)
		assert.strictEqual(resolveTapedeckSettings({ toolOutput: 'none' }).toolOutput, 'none')
	})

	it('stores changed keys and drops values equal to the default', () => {
		const changed = withTapedeckSetting({}, 'importFolder', 'Agents')
		assert.deepStrictEqual(changed, { importFolder: 'Agents' })
		assert.deepStrictEqual(withTapedeckSetting(changed, 'importFolder', 'Transcripts'), {})
	})

	it('ignores values that do not fit the schema', () => {
		assert.deepStrictEqual(withTapedeckSetting({}, 'toolOutput', 'some'), {})
	})

	it.effect('gives settings saved before shelves existed the default shelves', () =>
		Effect.gen(function* () {
			const settings = yield* loadTapedeckPluginSettings
			const resolved = resolveTapedeckSettings(settings)
			assert.strictEqual(resolved.importFolder, 'Agents')
			assert.deepStrictEqual(resolved.tapeShelves, defaultTapeShelves)
		}).pipe(
			Effect.provide(memoryPluginDataStoreLayer({ schemaVersion: 1, importFolder: 'Agents' })),
		),
	)

	it.effect('carries an old per-harness folder onto its default shelf', () =>
		Effect.gen(function* () {
			const resolved = resolveTapedeckSettings(yield* loadTapedeckPluginSettings)
			assert.deepStrictEqual(
				resolved.tapeShelves.map((shelf) => shelf.path),
				['/data/claude', '~/.codex/sessions', '~/.pi/agent/sessions'],
			)
		}).pipe(Effect.provide(memoryPluginDataStoreLayer({ claudeCodeDirectory: '/data/claude' }))),
	)

	it.effect('loads a saved shelf list as is', () =>
		Effect.gen(function* () {
			const resolved = resolveTapedeckSettings(yield* loadTapedeckPluginSettings)
			assert.deepStrictEqual(resolved.tapeShelves, [extraShelf])
		}).pipe(Effect.provide(memoryPluginDataStoreLayer({ tapeShelves: [extraShelf] }))),
	)

	it('stores an edited shelf list and drops the old folder keys', () => {
		const shelves = [...defaultTapeShelves, extraShelf]
		const next = withTapeShelves({ codexDirectory: '/data/codex', truncateLines: 5 }, shelves)
		assert.deepStrictEqual(next, { truncateLines: 5, tapeShelves: shelves })
	})

	it('restores defaults by dropping the shelf list', () => {
		const custom = withTapeShelves({}, [extraShelf])
		assert.deepStrictEqual(withTapeShelves(custom, undefined), {})
		assert.deepStrictEqual(withTapeShelves(custom, [...defaultTapeShelves]), {})
		assert.deepStrictEqual(resolveTapedeckSettings({}).tapeShelves, defaultTapeShelves)
	})

	it('keeps an empty shelf list empty', () => {
		assert.deepStrictEqual(resolveTapedeckSettings(withTapeShelves({}, [])).tapeShelves, [])
	})

	it.effect('drops the old recentCount key and keeps the rest', () =>
		Effect.gen(function* () {
			const settings = yield* loadTapedeckPluginSettings
			assert.deepStrictEqual(settings, { importFolder: 'Agents', truncateLines: 5 })
		}).pipe(
			Effect.provide(
				memoryPluginDataStoreLayer({ recentCount: 25, importFolder: 'Agents', truncateLines: 5 }),
			),
		),
	)
})
