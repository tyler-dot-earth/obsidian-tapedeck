import { homedir } from 'node:os'
import { basename, dirname, relative, sep } from 'node:path'

import { Result } from 'effect'

import { CodexThreadNames } from '#/src/tapedeck-codex-names'
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
const readInfo = async (file: SessionFile): Promise<TapeInfo> => {
	const head = await readHeadInfo(file, 0)

	if (head.kind === 'unreadable') {
		return head
	}

	const tail = await readTail(file.path, file.size, tailBytes).catch(() => '')
	const name = harnessName(file.source.harness, jsonLines(tail))

	return name === undefined ? head : { ...head, title: clampTitle(name), titleSource: 'name' }
}

/**
 * Tape info keyed by path, size, and mtime, kept for the life of the plugin. Reopening the picker
 * only reads tapes that are new or changed since last time. Codex names come from its session
 * index, so they are applied on the way out and follow renames without re-reading tapes.
 */
export class TapeInfoCache {
	private readonly entries = new Map<string, TapeInfo>()
	private readonly names: CodexThreadNames

	constructor(names: CodexThreadNames = new CodexThreadNames()) {
		this.names = names
	}

	private static key(file: SessionFile): string {
		return `${file.path}\u0000${file.size}\u0000${file.modifiedAt.getTime()}`
	}

	/** Refreshes Codex thread names for these tapes; call after listing the shelves. */
	async prepare(files: ReadonlyArray<SessionFile>): Promise<void> {
		const codex = files.filter((file) => file.source.harness === 'codex')
		await this.names.loadAll(codex.map((file) => file.path))
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

		const info = await readInfo(file)
		this.entries.set(TapeInfoCache.key(file), info)

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
 * Project guess from where the file sits, before its first lines are read: the encoded project
 * folder for Claude Code and Pi. Codex files sit in date folders, so they wait for the cwd.
 */
const projectFromLayout = (file: SessionFile, home: string): string | undefined => {
	if (file.source.harness === 'codex') {
		return undefined
	}

	const folder = relative(shelfRoot(file.shelf, home), dirname(file.path)).split(sep)[0] ?? ''

	return folder === '' || folder === '..' ? undefined : projectFromFolder(basename(folder), home)
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

/** Picker row for a tape, filled from cached info when there is some. */
export const tapeRow = (
	file: SessionFile,
	info: TapeInfo | undefined,
	notes: NoteLookup,
	home: string = homedir(),
): TapeRow => {
	const sessionId = info?.sessionId ?? sessionIdFromPath(file.path)
	const note = noteFor(file, sessionId, notes)

	return {
		path: file.path,
		harness: file.source.harness,
		emoji: file.source.emoji,
		agent: file.source.label,
		shelf: shelfName(file.shelf),
		modifiedAt: file.modifiedAt,
		project: projectFromCwd(info?.cwd) ?? projectFromLayout(file, home),
		...readFields(info),
		sessionId,
		state: tapeState(sessionId, file.modifiedAt, note),
		notePath: note?.path,
	}
}
