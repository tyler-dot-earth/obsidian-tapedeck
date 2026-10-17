import { loadPluginSettings, type PluginDataStore } from '@tyler.earth/effect-obsidian'
import { Effect, Option, Schema } from 'effect'

import { defaultFilenamePattern } from '#/src/dailies-filename'

/** Global plugin settings. Missing keys fall back to `dailiesDefaults`. */
export const DailiesPluginSettings = Schema.Struct({
	schemaVersion: Schema.optionalKey(Schema.Literal(1)),
	claudeCodeDirectory: Schema.optionalKey(Schema.String),
	codexDirectory: Schema.optionalKey(Schema.String),
	piDirectory: Schema.optionalKey(Schema.String),
	importFolder: Schema.optionalKey(Schema.String),
	filenamePattern: Schema.optionalKey(Schema.String),
	foldToolCalls: Schema.optionalKey(Schema.Boolean),
	toolOutput: Schema.optionalKey(Schema.Literals(['full', 'truncated', 'none'])),
	truncateLines: Schema.optionalKey(Schema.Number),
	includeThinking: Schema.optionalKey(Schema.Boolean),
	noteStyle: Schema.optionalKey(Schema.Literals(['raw', 'summary'])),
	recentCount: Schema.optionalKey(Schema.Number),
	redactHomePaths: Schema.optionalKey(Schema.Boolean),
	redactSecrets: Schema.optionalKey(Schema.Boolean),
})

export type DailiesPluginSettings = Schema.Schema.Type<typeof DailiesPluginSettings>

export type DailiesSettingKey = Exclude<keyof DailiesPluginSettings, 'schemaVersion'>

/** Settings with every default filled in. Empty directories mean the per-OS default. */
export type ResolvedDailiesSettings = Required<Omit<DailiesPluginSettings, 'schemaVersion'>>

export const dailiesDefaults: ResolvedDailiesSettings = {
	claudeCodeDirectory: '',
	codexDirectory: '',
	piDirectory: '',
	importFolder: 'Transcripts',
	filenamePattern: defaultFilenamePattern,
	foldToolCalls: true,
	toolOutput: 'full',
	truncateLines: 40,
	includeThinking: false,
	noteStyle: 'raw',
	recentCount: 10,
	redactHomePaths: true,
	redactSecrets: true,
}

export const dailiesSettingKeys: ReadonlyArray<DailiesSettingKey> = [
	'claudeCodeDirectory',
	'codexDirectory',
	'piDirectory',
	'importFolder',
	'filenamePattern',
	'foldToolCalls',
	'toolOutput',
	'truncateLines',
	'includeThinking',
	'noteStyle',
	'recentCount',
	'redactHomePaths',
	'redactSecrets',
]

/** Narrows a settings-tab control key. */
export const isDailiesSettingKey = (key: string): key is DailiesSettingKey =>
	dailiesSettingKeys.some((settingKey) => settingKey === key)

export const defaultDailiesPluginSettings: DailiesPluginSettings = DailiesPluginSettings.make({})

/** Fills defaults for every missing key. */
export const resolveDailiesSettings = (
	settings: DailiesPluginSettings,
): ResolvedDailiesSettings => ({ ...dailiesDefaults, ...settings })

/** Plugin surface the settings tab uses to persist settings. */
export interface DailiesPluginSettingsHost {
	settings: DailiesPluginSettings
	saveDailiesPluginSettings: () => Promise<void>
}

/**
 * Sets one key and re-decodes. Values that do not fit the schema leave settings unchanged. A value
 * equal to the default drops the key so data.json stays small.
 */
export const withDailiesSetting = (
	current: DailiesPluginSettings,
	key: DailiesSettingKey,
	value: Schema.Json,
): DailiesPluginSettings => {
	const next = Object.fromEntries(
		Object.entries({ ...current, [key]: value }).filter(
			([entryKey, entryValue]) =>
				!isDailiesSettingKey(entryKey) || entryValue !== dailiesDefaults[entryKey],
		),
	)

	return Option.getOrElse(Schema.decodeUnknownOption(DailiesPluginSettings)(next), () => current)
}

/** Loads Dailies settings, falling back to defaults when data.json is missing or invalid. */
export const loadDailiesPluginSettings: Effect.Effect<
	DailiesPluginSettings,
	never,
	PluginDataStore
> = loadPluginSettings({
	schema: DailiesPluginSettings,
	fallback: defaultDailiesPluginSettings,
}).pipe(
	Effect.tapError((error) => Effect.logWarning(`Dailies: using default settings (${error._tag})`)),
	Effect.catchTags({
		PluginDataLoadError: () => Effect.succeed(defaultDailiesPluginSettings),
		PluginSettingsDecodeError: () => Effect.succeed(defaultDailiesPluginSettings),
	}),
)
