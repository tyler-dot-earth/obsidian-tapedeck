import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { Effect } from 'effect'

import { TapedeckReadError, tapedeckErrorMessage } from '#/src/tapedeck-errors'
import type { ResolvedTapedeckSettings } from '#/src/tapedeck-plugin-settings'
import type { Harness, TranscriptSource } from '#/src/tapedeck-transcript'

/** One session file on disk. */
export interface SessionFile {
	readonly source: TranscriptSource
	readonly path: string
	readonly modifiedAt: Date
}

const directoryKeys: Record<Harness, 'claudeCodeDirectory' | 'codexDirectory' | 'piDirectory'> = {
	'claude-code': 'claudeCodeDirectory',
	'codex': 'codexDirectory',
	'pi': 'piDirectory',
}

/** Per-OS default, e.g. `~/.claude/projects` (on Windows `%USERPROFILE%\.claude\projects`). */
export const defaultSourceDirectory = (source: TranscriptSource, home: string): string =>
	join(home, ...source.defaultDirectory)

/** Configured directory, with a leading `~` expanded, or the per-OS default. */
export const sourceDirectory = (
	source: TranscriptSource,
	settings: ResolvedTapedeckSettings,
): string => {
	const configured = settings[directoryKeys[source.harness]].trim()

	return configured === '' ? defaultSourceDirectory(source, homedir()) : expandHome(configured)
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

const listFor = async (source: TranscriptSource, root: string): Promise<Array<SessionFile>> => {
	const paths = await walk(root, 0)

	const matching = paths.filter((path) =>
		source.matchesFile(relative(root, path).split(sep).join('/')),
	)

	return Promise.all(
		matching.map(async (path) => ({ source, path, modifiedAt: (await stat(path)).mtime })),
	)
}

/** Session files for the given sources, newest first. Missing directories list nothing. */
export const listSessionFiles = Effect.fn('Tapedeck.listSessionFiles')(function* (
	sources: ReadonlyArray<TranscriptSource>,
	settings: ResolvedTapedeckSettings,
) {
	const lists = yield* Effect.tryPromise({
		try: () =>
			Promise.all(sources.map((source) => listFor(source, sourceDirectory(source, settings)))),
		catch: (cause) => new TapedeckReadError({ message: tapedeckErrorMessage(cause) }),
	})

	return lists
		.flat()
		.toSorted((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime())
})

/** Reads a session file as UTF-8. */
export const readSessionFile = Effect.fn('Tapedeck.readSessionFile')(function* (path: string) {
	return yield* Effect.tryPromise({
		try: () => readFile(path, 'utf8'),
		catch: (cause) => new TapedeckReadError({ message: tapedeckErrorMessage(cause) }),
	})
})

/** Expands a leading `~` to the home directory. */
export const expandHome = (path: string): string =>
	path === '~' || path.startsWith('~/') || path.startsWith('~\\')
		? join(homedir(), path.slice(1))
		: path
