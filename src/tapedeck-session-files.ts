import { statSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { Effect } from 'effect'

import { TapedeckReadError, tapedeckErrorMessage } from '#/src/tapedeck-errors'
import { shelfRoot, type TapeShelf } from '#/src/tapedeck-shelves'
import { detectSource, sourceFor } from '#/src/tapedeck-sources'
import type { TranscriptSource } from '#/src/tapedeck-transcript'

/** One session file on disk. */
export interface SessionFile {
	readonly source: TranscriptSource
	readonly path: string
	readonly modifiedAt: Date
}

/** Whether a shelf's folder exists right now. Missing shelves are shown as unavailable. */
export const isShelfAvailable = (shelf: TapeShelf, home: string = homedir()): boolean => {
	const root = shelfRoot(shelf, home)

	return root !== '' && statSync(root, { throwIfNoEntry: false })?.isDirectory() === true
}

const maxDepth = 6

const walk = async (directory: string, depth: number): Promise<Array<string>> => {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])

	const nested = await Promise.all(
		entries.map(async (entry): Promise<Array<string>> => {
			const path = join(directory, entry.name)

			if (entry.isDirectory()) {
				return depth < maxDepth ? walk(path, depth + 1) : []
			}

			return entry.name.endsWith('.jsonl') ? [path] : []
		}),
	)

	return nested.flat()
}

/** Enough of the file for `detectSource`, which looks at the first lines only. */
const headBytes = 200_000

const readHead = async (path: string): Promise<string> => {
	const handle = await open(path, 'r')
	const read = await handle.read(Buffer.alloc(headBytes), 0, headBytes, 0).catch(() => undefined)
	await handle.close()

	return read === undefined ? '' : read.buffer.subarray(0, read.bytesRead).toString('utf8')
}

/**
 * Source for a file on an auto-detect shelf: whatever its first lines look like, as long as it sits
 * where that harness would put it or loose in the shelf folder. That keeps side files such as
 * Claude Code subagent logs out of the list.
 */
const detectFileSource = async (
	relativePath: string,
	path: string,
): Promise<TranscriptSource | undefined> => {
	const source = detectSource(await readHead(path).catch(() => ''))

	if (source === undefined) {
		return undefined
	}

	return source.matchesFile(relativePath) || !relativePath.includes('/') ? source : undefined
}

const fileSource = (
	shelf: TapeShelf,
	relativePath: string,
	path: string,
): Promise<TranscriptSource | undefined> => {
	if (shelf.harness === 'auto') {
		return detectFileSource(relativePath, path)
	}

	const source = sourceFor(shelf.harness)

	return Promise.resolve(source.matchesFile(relativePath) ? source : undefined)
}

const sessionFile = async (
	shelf: TapeShelf,
	root: string,
	path: string,
): Promise<Array<SessionFile>> => {
	const source = await fileSource(shelf, relative(root, path).split(sep).join('/'), path)

	if (source === undefined) {
		return []
	}

	const modified = await stat(path).catch(() => undefined)

	return modified === undefined ? [] : [{ source, path, modifiedAt: modified.mtime }]
}

const listShelf = async (shelf: TapeShelf, home: string): Promise<Array<SessionFile>> => {
	const root = shelfRoot(shelf, home)

	if (root === '') {
		return []
	}

	const files = await Promise.all(
		(await walk(root, 0)).map((path) => sessionFile(shelf, root, path)),
	)

	return files.flat()
}

/** Keeps the first entry for each path, for shelves that overlap. */
const uniqueByPath = (files: ReadonlyArray<SessionFile>): Array<SessionFile> => {
	const seen = new Set<string>()

	return files.filter((file) => {
		if (seen.has(file.path)) {
			return false
		}

		seen.add(file.path)

		return true
	})
}

/**
 * Session files on the enabled shelves, newest first. A shelf whose folder is missing or unreadable
 * lists nothing instead of failing the whole listing.
 */
export const listSessionFiles = Effect.fn('Tapedeck.listSessionFiles')(function* (
	shelves: ReadonlyArray<TapeShelf>,
	home: string = homedir(),
) {
	const lists = yield* Effect.tryPromise({
		try: () =>
			Promise.all(shelves.flatMap((shelf) => (shelf.enabled ? [listShelf(shelf, home)] : []))),
		catch: (cause) => new TapedeckReadError({ message: tapedeckErrorMessage(cause) }),
	})

	return uniqueByPath(lists.flat()).toSorted(
		(left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime(),
	)
})

/** Reads a session file as UTF-8. */
export const readSessionFile = Effect.fn('Tapedeck.readSessionFile')(function* (path: string) {
	return yield* Effect.tryPromise({
		try: () => readFile(path, 'utf8'),
		catch: (cause) => new TapedeckReadError({ message: tapedeckErrorMessage(cause) }),
	})
})
