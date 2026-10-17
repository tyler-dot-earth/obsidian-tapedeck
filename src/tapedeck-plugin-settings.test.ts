import { assert, describe, it } from '@effect/vitest'
import { memoryPluginDataStoreLayer } from '@tyler.earth/effect-obsidian'
import { Effect } from 'effect'

import {
	tapedeckDefaults,
	defaultTapedeckPluginSettings,
	loadTapedeckPluginSettings,
	resolveTapedeckSettings,
	withTapedeckSetting,
} from '#/src/tapedeck-plugin-settings'

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
})
