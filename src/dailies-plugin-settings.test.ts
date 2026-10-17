import { assert, describe, it } from '@effect/vitest'
import { memoryPluginDataStoreLayer } from '@tyler.earth/effect-obsidian'
import { Effect } from 'effect'

import {
	dailiesDefaults,
	defaultDailiesPluginSettings,
	loadDailiesPluginSettings,
	resolveDailiesSettings,
	withDailiesSetting,
} from '#/src/dailies-plugin-settings'

describe('Dailies plugin settings', () => {
	it.effect('uses defaults when plugin data is missing', () =>
		Effect.gen(function* () {
			const settings = yield* loadDailiesPluginSettings
			assert.deepStrictEqual(settings, defaultDailiesPluginSettings)
		}).pipe(Effect.provide(memoryPluginDataStoreLayer())),
	)

	it.effect('falls back when stored data is not an object', () =>
		Effect.gen(function* () {
			const settings = yield* loadDailiesPluginSettings
			assert.deepStrictEqual(settings, defaultDailiesPluginSettings)
		}).pipe(Effect.provide(memoryPluginDataStoreLayer('nope'))),
	)

	it('fills defaults for missing keys', () => {
		assert.deepStrictEqual(resolveDailiesSettings({}), dailiesDefaults)
		assert.strictEqual(resolveDailiesSettings({ toolOutput: 'none' }).toolOutput, 'none')
	})

	it('stores changed keys and drops values equal to the default', () => {
		const changed = withDailiesSetting({}, 'importFolder', 'Agents')
		assert.deepStrictEqual(changed, { importFolder: 'Agents' })
		assert.deepStrictEqual(withDailiesSetting(changed, 'importFolder', 'Transcripts'), {})
	})

	it('ignores values that do not fit the schema', () => {
		assert.deepStrictEqual(withDailiesSetting({}, 'toolOutput', 'some'), {})
	})
})
