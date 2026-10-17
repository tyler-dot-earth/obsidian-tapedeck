import { homedir } from 'node:os'
import { join } from 'node:path'

import { Schema } from 'effect'

import { transcriptSources } from '#/src/tapedeck-sources'
import type { Harness } from '#/src/tapedeck-transcript'

/** Which harness a shelf holds. `auto` reads the first lines of each file to tell. */
export const ShelfHarness = Schema.Literals(['auto', 'claude-code', 'codex', 'pi'])

export type ShelfHarness = Schema.Schema.Type<typeof ShelfHarness>

/**
 * A tape shelf: a folder Tapedeck lists tapes from without asking for a path each time. `path` is
 * stored as typed, so `~` stays portable between machines and is expanded only when read.
 */
export const TapeShelf = Schema.Struct({
	path: Schema.String,
	label: Schema.optionalKey(Schema.String),
	harness: ShelfHarness,
	enabled: Schema.Boolean,
})

export type TapeShelf = Schema.Schema.Type<typeof TapeShelf>

/** Labels for the harness picker, in the order they are offered. */
export const shelfHarnessLabels: Record<ShelfHarness, string> = {
	'auto': 'Auto-detect',
	'claude-code': 'Claude Code',
	'codex': 'Codex CLI',
	'pi': 'Pi',
}

/**
 * One shelf per harness at the folder it writes sessions to by default (`defaultDirectory` on each
 * source): `~/.claude/projects`, `~/.codex/sessions`, `~/.pi/agent/sessions`.
 */
export const defaultTapeShelves: ReadonlyArray<TapeShelf> = transcriptSources.map((source) => ({
	path: ['~', ...source.defaultDirectory].join('/'),
	label: source.label,
	harness: source.harness,
	enabled: true,
}))

/**
 * Expands a leading `~`, `~/` or `~\` to `home`. Separators after it may be `/` or `\` and are
 * rejoined with the platform separator, so `~/.codex/sessions` works on Windows too. `~user` and
 * paths without a leading `~` are returned unchanged.
 */
export const expandHome = (path: string, home: string = homedir()): string => {
	if (path === '~') {
		return home
	}

	if (!path.startsWith('~/') && !path.startsWith('~\\')) {
		return path
	}

	return join(
		home,
		...path
			.slice(2)
			.split(/[/\\]+/)
			.filter((part) => part !== ''),
	)
}

/** Folder a shelf points at, ready for `node:fs`. */
export const shelfRoot = (shelf: TapeShelf, home: string = homedir()): string =>
	expandHome(shelf.path.trim(), home)

/** Name shown for a shelf: its label, or its path when the label is empty. */
export const shelfName = (shelf: TapeShelf): string => {
	const label = shelf.label?.trim() ?? ''

	return label === '' ? shelf.path : label
}

/** Pre-shelf settings: one optional folder override per harness. */
export interface LegacySourceDirectories {
	readonly claudeCodeDirectory?: string
	readonly codexDirectory?: string
	readonly piDirectory?: string
}

const legacyKeys: Record<Harness, keyof LegacySourceDirectories> = {
	'claude-code': 'claudeCodeDirectory',
	'codex': 'codexDirectory',
	'pi': 'piDirectory',
}

/**
 * Default shelves for settings saved before shelves existed. A folder the user had set for a
 * harness replaces that harness's default path, so an upgrade keeps reading the same place.
 */
export const migratedDefaultShelves = (legacy: LegacySourceDirectories): ReadonlyArray<TapeShelf> =>
	defaultTapeShelves.map((shelf) => {
		if (shelf.harness === 'auto') {
			return shelf
		}

		const configured = legacy[legacyKeys[shelf.harness]]?.trim() ?? ''

		return configured === '' ? shelf : { ...shelf, path: configured }
	})

/** Structural equality, used to drop a shelf list that matches the defaults. */
export const sameShelves = (
	left: ReadonlyArray<TapeShelf>,
	right: ReadonlyArray<TapeShelf>,
): boolean =>
	left.length === right.length &&
	left.every((shelf, index) => {
		const other = right[index]

		return (
			other !== undefined &&
			shelf.path === other.path &&
			(shelf.label ?? '') === (other.label ?? '') &&
			shelf.harness === other.harness &&
			shelf.enabled === other.enabled
		)
	})
