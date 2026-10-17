import { homedir } from 'node:os'
import { basename, dirname, relative, sep } from 'node:path'

import { Result } from 'effect'

import { CodexThreadNames } from '#/src/tapedeck-codex-names'
import { TimeSlicer } from '#/src/tapedeck-concurrency'
import { ProjectPlaces } from '#/src/tapedeck-project-places'
import { placeFromEncodedName, type ProjectPlace } from '#/src/tapedeck-projects'
import { readHead, readTail, type SessionFile } from '#/src/tapedeck-session-files'
import { shelfName, shelfRoot } from '#/src/tapedeck-shelves'
import {
	type ImportedNote,
	type NoteLookup,
	projectFromCwd,
	projectFromFolder,
	sessionIdFromPath,
	type TapeKind,
	type TapeRow,
	tapeState,
} from '#/src/tapedeck-tape-list'
import { clampTitle, harnessName, type TitleSource } from '#/src/tapedeck-tape-title'
import { jsonLines, type Transcript } from '#/src/tapedeck-transcript'

/** What the picker reads from a tape's head and tail. */
export interface TapeInfo {
	readonly title: string
	readonly titleSource: TitleSource
	readonly kind: TapeKind
	readonly cwd: string | undefined
	readonly sessionId: string | undefined
	/** Main repo and worktree for the cwd, from the file system. */
	readonly place: ProjectPlace | undefined
}

/**
 * Bytes read from the head. The cwd and first prompt sit near the top, so 64 KB is usually enough.
 * When that chunk does not parse or holds no prompt and the file is bigger, one retry reads 1 MB.
 * Whole files are never read just to fill the list.
 */
const chunkSizes: ReadonlyArray<number> = [64 * 1024, 1024 * 1024]

/** Bytes read from the end, where harnesses append session names. */
const tailBytes = 64 * 1024

const unreadable: TapeInfo = {
	title: 'unreadable tape',
	titleSource: 'fallback',
	kind: 'unreadable',
	cwd: undefined,
	sessionId: undefined,
	place: undefined,
}

const kindOf = (transcript: Transcript, wholeFile: boolean): TapeKind => {
	if (transcript.subagent) {
		return 'subagent'
	}

	return transcript.turns.length === 0 && wholeFile ? 'empty' : 'session'
}

const infoFromChunk = (
	file: SessionFile,
	text: string,
	wholeFile: boolean,
): TapeInfo | undefined => {
	const parsed = file.source.parse(text)

	if (Result.isFailure(parsed)) {
		return undefined
	}

	const transcript = parsed.success

	return {
		title: transcript.title,
		titleSource: transcript.titleSource,
		kind: kindOf(transcript, wholeFile),
		cwd: transcript.cwd,
		sessionId: transcript.sessionId,
		place: undefined,
	}
}

const readHeadInfo = async (file: SessionFile, attempt: number): Promise<TapeInfo> => {
	const bytes = chunkSizes[attempt] ?? 0
	const text = await readHead(file.path, bytes).catch(() => '')
	const info = infoFromChunk(file, text, file.size <= bytes)
	const hasMore = file.size > bytes && attempt + 1 < chunkSizes.length

	if (info !== undefined && (info.titleSource !== 'fallback' || !hasMore)) {
		return info
	}

	return hasMore ? readHeadInfo(file, attempt + 1) : (info ?? unreadable)
}

/** Head info, renamed by a session name found in the last 64 KB (names are appended). */
const readInfo = async (file: SessionFile, places: ProjectPlaces): Promise<TapeInfo> => {
	const head = await readHeadInfo(file, 0)

	if (head.kind === 'unreadable') {
		return head
	}

	const tail = await readTail(file.path, file.size, tailBytes).catch(() => '')
	const name = harnessName(file.source.harness, jsonLines(tail))

	const place =
		head.cwd === undefined ? undefined : await places.forCwd(head.cwd).catch(() => undefined)

	const placed = { ...head, place }

	return name === undefined ? placed : { ...placed, title: clampTitle(name), titleSource: 'name' }
}

/**
 * Tape info keyed by path, size, and mtime, kept for the life of the plugin. Reopening the picker
 * only reads tapes that are new or changed since last time. Codex names come from its session
 * index, so they are applied on the way out and follow renames without re-reading tapes.
 */
export class TapeInfoCache {
	private readonly entries = new Map<string, TapeInfo>()
	private readonly names: CodexThreadNames
	private readonly places: ProjectPlaces
	private readonly slicer = new TimeSlicer()

	constructor(
		names: CodexThreadNames = new CodexThreadNames(),
		places: ProjectPlaces = new ProjectPlaces(),
	) {
		this.names = names
		this.places = places
	}

	private static key(file: SessionFile): string {
		return `${file.path}\u0000${file.size}\u0000${file.modifiedAt.getTime()}`
	}

	/**
	 * Refreshes Codex thread names and resolves Claude Code and Pi project folders for these tapes;
	 * call after listing the shelves.
	 */
	async prepare(files: ReadonlyArray<SessionFile>, home: string = homedir()): Promise<void> {
		const codex = files.filter((file) => file.source.harness === 'codex')
		const folders = files.flatMap((file) => layoutFolder(file, home) ?? [])
		await this.names.loadAll(codex.map((file) => file.path))
		await this.places.prepareFolders(folders)
	}

	/** Row for a tape from what is known about it so far. */
	row(
		file: SessionFile,
		info: TapeInfo | undefined,
		notes: NoteLookup,
		home: string = homedir(),
	): TapeRow {
		const folder = layoutFolder(file, home)
		const guess = folder === undefined ? undefined : this.places.folder(folder)

		return tapeRow(file, info, notes, { home, resolved: guess })
	}

	/** Cached info, if this exact version of the file was read before. */
	peek(file: SessionFile): TapeInfo | undefined {
		const info = this.entries.get(TapeInfoCache.key(file))

		return info === undefined ? undefined : this.named(file, info)
	}

	/** Reads (or recalls) the title, kind, cwd, and session id of a tape. */
	async read(file: SessionFile): Promise<TapeInfo> {
		const cached = this.peek(file)

		if (cached !== undefined) {
			return cached
		}

		const info = await readInfo(file, this.places)
		this.entries.set(TapeInfoCache.key(file), info)
		await this.slicer.pause()

		return this.named(file, info)
	}

	private named(file: SessionFile, info: TapeInfo): TapeInfo {
		const name =
			file.source.harness === 'codex' && info.sessionId !== undefined
				? this.names.get(file.path, info.sessionId)
				: undefined

		return name === undefined ? info : { ...info, title: clampTitle(name), titleSource: 'name' }
	}
}

/**
 * The encoded project folder a Claude Code or Pi tape sits in. Codex files sit in date folders, so
 * they have none.
 */
const layoutFolder = (file: SessionFile, home: string): string | undefined => {
	if (file.source.harness === 'codex') {
		return undefined
	}

	const folder = relative(shelfRoot(file.shelf, home), dirname(file.path)).split(sep)[0] ?? ''

	return folder === '' || folder === '..' ? undefined : basename(folder)
}

/**
 * Project guess before a tape is read: the resolved project folder when there is one, else a guess
 * from its encoded name (with `-worktrees-` read as repo and worktree).
 */
const placeFromLayout = (
	file: SessionFile,
	home: string,
	resolved: ProjectPlace | undefined,
): ProjectPlace | undefined => {
	const folder = layoutFolder(file, home)

	if (resolved !== undefined || folder === undefined) {
		return resolved
	}

	return placeFromEncodedName(projectFromFolder(folder, home) ?? '')
}

/** Project for a row: from the cwd's repo, else the cwd's folder, else the layout guess. */
const rowPlace = (
	file: SessionFile,
	info: TapeInfo | undefined,
	home: string,
	resolved: ProjectPlace | undefined,
): ProjectPlace | undefined => {
	if (info?.place !== undefined) {
		return info.place
	}

	const fromCwd = projectFromCwd(info?.cwd)

	return fromCwd === undefined
		? placeFromLayout(file, home, resolved)
		: { project: fromCwd, worktree: undefined }
}

const noteFor = (
	file: SessionFile,
	sessionId: string | undefined,
	notes: NoteLookup,
): ImportedNote | undefined =>
	sessionId === undefined ? undefined : notes(file.source.harness, sessionId)

const readFields = (info: TapeInfo | undefined): Pick<TapeRow, 'title' | 'kind'> => ({
	title: info?.title,
	kind: info?.kind,
})

/** Home folder (for tests) and a resolved project folder for a row. */
export interface RowWhere {
	readonly home?: string
	readonly resolved?: ProjectPlace | undefined
}

/** Picker row for a tape, filled from cached info when there is some. */
export const tapeRow = (
	file: SessionFile,
	info: TapeInfo | undefined,
	notes: NoteLookup,
	where: RowWhere = {},
): TapeRow => {
	const home = where.home ?? homedir()
	const { resolved } = where
	const sessionId = info?.sessionId ?? sessionIdFromPath(file.path)
	const note = noteFor(file, sessionId, notes)
	const place = rowPlace(file, info, home, resolved)

	return {
		path: file.path,
		harness: file.source.harness,
		emoji: file.source.emoji,
		agent: file.source.label,
		shelf: shelfName(file.shelf),
		modifiedAt: file.modifiedAt,
		project: place?.project,
		worktree: place?.worktree,
		...readFields(info),
		sessionId,
		state: tapeState(sessionId, file.modifiedAt, note),
		notePath: note?.path,
	}
}
