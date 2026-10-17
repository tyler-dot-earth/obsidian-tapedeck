import { loadPluginSettings, type PluginDataStore } from '@tyler.earth/effect-obsidian'
import { Effect, Option, Schema } from 'effect'

import { defaultFilenamePattern } from '#/src/tapedeck-filename'
import {
	defaultTapeShelves,
	migratedDefaultShelves,
	sameShelves,
	TapeShelf,
} from '#/src/tapedeck-shelves'

/**
 * Global plugin settings. Missing keys fall back to `tapedeckDefaults`. A missing `tapeShelves`
 * means the default shelves. The three `*Directory` keys are from before shelves; they are still
 * decoded so an upgrade carries a customised folder onto its default shelf, and are dropped the
 * first time the shelf list is saved. `recentCount` (how many tapes the old picker listed) is gone:
 * the picker now searches every tape, and decoding drops the stale key from older data.
 */
export const TapedeckPluginSettings = Schema.Struct({
	schemaVersion: Schema.optionalKey(Schema.Literal(1)),
	tapeShelves: Schema.optionalKey(Schema.Array(TapeShelf)),
	claudeCodeDirectory: Schema.optionalKey(Schema.String),
	codexDirectory: Schema.optionalKey(Schema.String),
	piDirectory: Schema.optionalKey(Schema.String),
	importFolder: Schema.optionalKey(Schema.String),
	filenamePattern: Schema.optionalKey(Schema.String),
	foldToolCalls: Schema.optionalKey(Schema.Boolean),
	toolOutput: Schema.optionalKey(Schema.Literals(['full', 'truncated', 'none'])),
	truncateLines: Schema.optionalKey(Schema.Number),
	includeThinking: Schema.optionalKey(Schema.Boolean),
	showAbandonedBranches: Schema.optionalKey(Schema.Boolean),
	noteStyle: Schema.optionalKey(Schema.Literals(['raw', 'summary'])),
	redactHomePaths: Schema.optionalKey(Schema.Boolean),
	redactSecrets: Schema.optionalKey(Schema.Boolean),
	includeMachine: Schema.optionalKey(Schema.Boolean),
	importImages: Schema.optionalKey(Schema.Boolean),
	maxImageMB: Schema.optionalKey(Schema.Number),
})

export type TapedeckPluginSettings = Schema.Schema.Type<typeof TapedeckPluginSettings>

type LegacyKey = 'claudeCodeDirectory' | 'codexDirectory' | 'piDirectory'

const legacyKeys: ReadonlySet<string> = new Set([
	'claudeCodeDirectory',
	'codexDirectory',
	'piDirectory',
])

/** Keys set through plain settings-tab controls. Shelves have their own editor. */
export type TapedeckSettingKey = Exclude<
	keyof TapedeckPluginSettings,
	'schemaVersion' | 'tapeShelves' | LegacyKey
>

/** Settings with every default filled in. */
export type ResolvedTapedeckSettings = Required<
	Omit<TapedeckPluginSettings, 'schemaVersion' | LegacyKey>
>

export const tapedeckDefaults: ResolvedTapedeckSettings = {
	tapeShelves: defaultTapeShelves,
	importFolder: 'Transcripts',
	filenamePattern: defaultFilenamePattern,
	foldToolCalls: true,
	toolOutput: 'full',
	truncateLines: 40,
	includeThinking: false,
	showAbandonedBranches: false,
	noteStyle: 'raw',
	redactHomePaths: true,
	redactSecrets: true,
	includeMachine: true,
	importImages: true,
	maxImageMB: 0,
}

export const tapedeckSettingKeys: ReadonlyArray<TapedeckSettingKey> = [
	'importFolder',
	'filenamePattern',
	'foldToolCalls',
	'toolOutput',
	'truncateLines',
	'includeThinking',
	'showAbandonedBranches',
	'noteStyle',
	'redactHomePaths',
	'redactSecrets',
	'includeMachine',
	'importImages',
	'maxImageMB',
]

/** Narrows a settings-tab control key. */
export const isTapedeckSettingKey = (key: string): key is TapedeckSettingKey =>
	tapedeckSettingKeys.some((settingKey) => settingKey === key)

export const defaultTapedeckPluginSettings: TapedeckPluginSettings = TapedeckPluginSettings.make({})

/** Fills defaults for every missing key. Settings without shelves get the (migrated) defaults. */
export const resolveTapedeckSettings = (
	settings: TapedeckPluginSettings,
): ResolvedTapedeckSettings => ({
	...tapedeckDefaults,
	...settings,
	tapeShelves: settings.tapeShelves ?? migratedDefaultShelves(settings),
})

/**
 * Replaces the shelf list. `undefined`, or a list equal to the defaults, drops the key so the
 * defaults apply (this is how "restore defaults" works). Pre-shelf folder keys are dropped either
 * way, since the list now says where to look.
 */
export const withTapeShelves = (
	current: TapedeckPluginSettings,
	shelves: ReadonlyArray<TapeShelf> | undefined,
): TapedeckPluginSettings => {
	const kept = Object.fromEntries(
		Object.entries(current).filter(([key]) => key !== 'tapeShelves' && !legacyKeys.has(key)),
	)

	const next =
		shelves === undefined || sameShelves(shelves, defaultTapeShelves)
			? kept
			: { ...kept, tapeShelves: shelves }

	return Option.getOrElse(Schema.decodeUnknownOption(TapedeckPluginSettings)(next), () => current)
}

/** Plugin surface the settings tab uses to persist settings. */
export interface TapedeckPluginSettingsHost {
	settings: TapedeckPluginSettings
	saveTapedeckPluginSettings: () => Promise<void>
}

/**
 * Sets one key and re-decodes. Values that do not fit the schema leave settings unchanged. A value
 * equal to the default drops the key so data.json stays small.
 */
export const withTapedeckSetting = (
	current: TapedeckPluginSettings,
	key: TapedeckSettingKey,
	value: Schema.Json,
): TapedeckPluginSettings => {
	const next = Object.fromEntries(
		Object.entries({ ...current, [key]: value }).filter(
			([entryKey, entryValue]) =>
				!isTapedeckSettingKey(entryKey) || entryValue !== tapedeckDefaults[entryKey],
		),
	)

	return Option.getOrElse(Schema.decodeUnknownOption(TapedeckPluginSettings)(next), () => current)
}

/** Loads Tapedeck settings, falling back to defaults when data.json is missing or invalid. */
export const loadTapedeckPluginSettings: Effect.Effect<
	TapedeckPluginSettings,
	never,
	PluginDataStore
> = loadPluginSettings({
	schema: TapedeckPluginSettings,
	fallback: defaultTapedeckPluginSettings,
}).pipe(
	Effect.tapError((error) => Effect.logWarning(`Tapedeck: using default settings (${error._tag})`)),
	Effect.catchTags({
		PluginDataLoadError: () => Effect.succeed(defaultTapedeckPluginSettings),
		PluginSettingsDecodeError: () => Effect.succeed(defaultTapedeckPluginSettings),
	}),
)
