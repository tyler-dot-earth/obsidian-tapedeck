import { localDate, localTime } from '#/src/tapedeck-filename'
import type { Harness } from '#/src/tapedeck-transcript'

/**
 * Pure pieces of the tape picker: project names, search, and multi-select. The modal and the file
 * reading live elsewhere so these stay easy to test.
 */

/** What the picker knows about one tape. `title` is undefined until its first lines are read. */
export interface TapeRow {
	readonly path: string
	readonly harness: Harness
	readonly emoji: string
	readonly agent: string
	readonly shelf: string
	readonly modifiedAt: Date
	/** Main repo (or folder) the session ran in. */
	readonly project: string | undefined
	/** Worktree folder, when the session ran in a git worktree of `project`. */
	readonly worktree: string | undefined
	readonly title: string | undefined
	/** What the tape is, once read; subagent threads and empty files are left out of lists. */
	readonly kind: TapeKind | undefined
	readonly sessionId: string | undefined
	readonly state: TapeState
	/** Vault path of the tape's note, when it has one. */
	readonly notePath: string | undefined
}

/**
 * What a tape is: a `session` you ran, a `subagent` thread an agent started, an `empty` file with
 * no messages, or `unreadable`. Lists leave out subagent threads and empty files.
 */
export type TapeKind = 'session' | 'subagent' | 'empty' | 'unreadable'

/**
 * Whether a tape belongs in the picker and rack lists. Unread Claude Code and Pi tapes are listed
 * at once; unread Codex tapes wait for their first line, since most Codex files are subagent
 * threads and would otherwise flash into the list and vanish.
 */
export const isListed = (row: TapeRow): boolean => {
	if (row.kind === undefined) {
		return row.harness !== 'codex'
	}

	return row.kind !== 'subagent' && row.kind !== 'empty'
}

/**
 * Where a tape stands against the vault: `unknown` until its session id is known, `new` with no
 * note, `imported` with a note, `changed` when the file was modified after the note was written.
 */
export type TapeState = 'unknown' | 'new' | 'imported' | 'changed'

/** A transcript note already in the vault: its path and when it was last imported, if recorded. */
export interface ImportedNote {
	readonly path: string
	readonly importedAt: Date | undefined
}

/** Finds the note for a session, if there is one. */
export type NoteLookup = (harness: Harness, sessionId: string) => ImportedNote | undefined

/** Grace period for "changed": the file is often touched just before an import finishes. */
const changedGraceMs = 60_000

/** State of a tape from its session id, file mtime, and note. */
export const tapeState = (
	sessionId: string | undefined,
	modifiedAt: Date,
	note: ImportedNote | undefined,
): TapeState => {
	if (sessionId === undefined) {
		return 'unknown'
	}

	if (note === undefined) {
		return 'new'
	}

	return note.importedAt !== undefined &&
		modifiedAt.getTime() > note.importedAt.getTime() + changedGraceMs
		? 'changed'
		: 'imported'
}

const uuidAtEnd = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

/**
 * Session id from a file name, before the file is read: all three harnesses end the name with it
 * (`<id>.jsonl`, `rollout-<time>-<id>.jsonl`, `<time>_<id>.jsonl`).
 */
export const sessionIdFromPath = (path: string): string | undefined =>
	uuidAtEnd.exec(path)?.[1]?.toLowerCase()

/** Whether the vault already has a note for the tape. */
export const isInVault = (row: TapeRow): boolean =>
	row.state === 'imported' || row.state === 'changed'

const stateMarks: Record<TapeState, string> = {
	unknown: '',
	new: '',
	imported: ' · ⏪ in vault',
	changed: ' · ⏩ changed since import',
}

/** Last folder of a working directory, for either separator. `undefined` for an empty path. */
export const projectFromCwd = (cwd: string | undefined): string | undefined => {
	const parts = (cwd ?? '').split(/[/\\]+/).filter((part) => part !== '')
	const last = parts.at(-1)

	return last === undefined || /^[A-Za-z]:$/.test(last) ? undefined : last
}

/** How Claude Code and Pi turn a path into a folder name: anything but letters and digits is `-`. */
const encodeLikeFolder = (path: string): string => path.replace(/[^A-Za-z0-9]/g, '-')

/**
 * Project name guessed from a Claude Code (`-home-me-code-app`) or Pi (`--home-me-code-app--`)
 * project folder, used until the session's own cwd is read. The encoding is lossy, so this only
 * strips the encoded home folder: `code-app` rather than a guess at where the dashes were. A hidden
 * folder (`~/.work/app`, encoded `--work-app`) loses its leading dash too.
 */
export const projectFromFolder = (folder: string, home: string): string | undefined => {
	const trimmed = folder.replace(/^-+|-+$/g, '')
	const encodedHome = encodeLikeFolder(home).replace(/^-+|-+$/g, '')

	if (encodedHome !== '' && trimmed === encodedHome) {
		return undefined
	}

	const rest =
		encodedHome !== '' && trimmed.startsWith(`${encodedHome}-`)
			? trimmed.slice(encodedHome.length + 1).replace(/^-+/, '')
			: trimmed

	return rest === '' ? undefined : rest
}

/** `mixtape · side-b` for a worktree session, the project alone otherwise. */
export const projectText = (row: TapeRow): string | undefined => {
	if (row.project === undefined) {
		return undefined
	}

	return row.worktree === undefined ? row.project : `${row.project} · ${row.worktree}`
}

/** `2026-01-15 09:00`, local time. */
export const tapeWhen = (row: TapeRow): string =>
	`${localDate(row.modifiedAt)} ${localTime(row.modifiedAt)}`

/** Text a search query is matched against: agent, shelf, project, first prompt, and date. */
export const tapeSearchText = (row: TapeRow): string =>
	[row.agent, row.shelf, row.project ?? '', row.worktree ?? '', row.title ?? '', tapeWhen(row)]
		.join(' ')
		.toLowerCase()

/**
 * Listed rows matching every word of the query, in their original (newest first) order. Words match
 * anywhere, case-insensitively, so `mixtape 2026-01` finds January tapes of the mixtape project.
 */
export const filterTapes = (rows: ReadonlyArray<TapeRow>, query: string): Array<TapeRow> =>
	searchTapes(rows.filter(isListed), query)

/** Rows matching every word of the query, listed or not. */
export const searchTapes = (rows: ReadonlyArray<TapeRow>, query: string): Array<TapeRow> => {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word !== '')

	if (words.length === 0) {
		return [...rows]
	}

	return rows.filter((row) => {
		const text = tapeSearchText(row)

		return words.every((word) => text.includes(word))
	})
}

/** One-line label for a row: emoji, date, project, first prompt, and a mark if in the vault. */
export const tapeLabel = (row: TapeRow): string => {
	const parts = [`${row.emoji} ${tapeWhen(row)}`, projectText(row) ?? '—', row.title ?? 'reading…']

	return `${parts.join(' · ')}${stateMarks[row.state]}`
}

/** Selected tape paths. Paths survive filtering, so a selection is kept while you search. */
export type TapeSelection = ReadonlySet<string>

/** Adds or removes one path. */
export const toggleTape = (selection: TapeSelection, path: string): TapeSelection => {
	const next = new Set(selection)

	if (next.has(path)) {
		next.delete(path)
	} else {
		next.add(path)
	}

	return next
}

/** Selects every row currently shown, keeping selections outside the filter. */
export const selectShown = (
	selection: TapeSelection,
	shown: ReadonlyArray<TapeRow>,
): TapeSelection => new Set([...selection, ...shown.map((row) => row.path)])

/** Clears every row currently shown, keeping selections outside the filter. */
export const clearShown = (
	selection: TapeSelection,
	shown: ReadonlyArray<TapeRow>,
): TapeSelection => {
	const hidden = new Set(shown.map((row) => row.path))

	return new Set([...selection].filter((path) => !hidden.has(path)))
}

/** Whether every shown row is selected (false when nothing is shown). */
export const allShownSelected = (
	selection: TapeSelection,
	shown: ReadonlyArray<TapeRow>,
): boolean => shown.length > 0 && shown.every((row) => selection.has(row.path))

/** Selected rows in list order, which is what gets imported. */
export const selectedTapes = (
	rows: ReadonlyArray<TapeRow>,
	selection: TapeSelection,
): Array<TapeRow> => rows.filter((row) => selection.has(row.path))

/** Moves the highlighted row by `delta`, clamped to the list. `-1` means nothing highlighted. */
export const moveActive = (active: number, delta: number, length: number): number => {
	if (length === 0) {
		return -1
	}

	return Math.min(length - 1, Math.max(0, active + delta))
}

/** "Import 3 tapes" / "Import 1 tape". */
export const importButtonText = (count: number): string =>
	`Import ${count} ${count === 1 ? 'tape' : 'tapes'}`
