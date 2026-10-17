import { homedir } from 'node:os'
import { basename, dirname, relative, sep } from 'node:path'

import { Result } from 'effect'

import { readHead, type SessionFile } from '#/src/tapedeck-session-files'
import { shelfName, shelfRoot } from '#/src/tapedeck-shelves'
import {
	type ImportedNote,
	type NoteLookup,
	projectFromCwd,
	projectFromFolder,
	sessionIdFromPath,
	type TapeRow,
	tapeState,
} from '#/src/tapedeck-tape-list'

/** What the picker reads from the start of a tape. */
export interface TapeInfo {
	readonly title: string
	readonly cwd: string | undefined
	readonly sessionId: string | undefined
}

/**
 * Bytes read per tape. The first prompt and the cwd sit near the top, so 64 KB is usually enough.
 * When that chunk does not parse (a huge first line, say) and the file is bigger, one retry reads 1
 * MB. Whole files are never read just to fill the list.
 */
const chunkSizes: ReadonlyArray<number> = [64 * 1024, 1024 * 1024]

const unreadable: TapeInfo = { title: 'unreadable tape', cwd: undefined, sessionId: undefined }

const infoFromChunk = (file: SessionFile, text: string): TapeInfo | undefined => {
	const parsed = file.source.parse(text)

	if (Result.isFailure(parsed)) {
		return undefined
	}

	const { title, cwd, sessionId } = parsed.success

	return { title, cwd, sessionId }
}

const readInfo = async (file: SessionFile, attempt: number): Promise<TapeInfo> => {
	const bytes = chunkSizes[attempt] ?? 0
	const text = await readHead(file.path, bytes).catch(() => '')
	const info = infoFromChunk(file, text)
	const hasMore = file.size > bytes && attempt + 1 < chunkSizes.length

	if (info !== undefined && (info.title !== 'Untitled session' || !hasMore)) {
		return info
	}

	return hasMore ? readInfo(file, attempt + 1) : (info ?? unreadable)
}

/**
 * Tape headers keyed by path, size, and mtime, kept for the life of the plugin. Reopening the
 * picker only reads tapes that are new or changed since last time.
 */
export class TapeInfoCache {
	private readonly entries = new Map<string, TapeInfo>()

	private static key(file: SessionFile): string {
		return `${file.path}\u0000${file.size}\u0000${file.modifiedAt.getTime()}`
	}

	/** Cached info, if this exact version of the file was read before. */
	peek(file: SessionFile): TapeInfo | undefined {
		return this.entries.get(TapeInfoCache.key(file))
	}

	/** Reads (or recalls) the first prompt, cwd, and session id of a tape. */
	async read(file: SessionFile): Promise<TapeInfo> {
		const cached = this.peek(file)

		if (cached !== undefined) {
			return cached
		}

		const info = await readInfo(file, 0)
		this.entries.set(TapeInfoCache.key(file), info)

		return info
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
		title: info?.title,
		sessionId,
		state: tapeState(sessionId, file.modifiedAt, note),
		notePath: note?.path,
	}
}
