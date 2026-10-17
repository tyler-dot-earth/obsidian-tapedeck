import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { codexThreadNames } from '#/src/tapedeck-tape-title'
import { jsonLines } from '#/src/tapedeck-transcript'

/** Codex keeps sessions under `$CODEX_HOME/sessions` (and `archived_sessions`). */
const sessionFolders = new Set(['sessions', 'archived_sessions'])

/** `$CODEX_HOME/session_index.jsonl` for a Codex session file, found by walking up its folders. */
export const codexIndexPath = (sessionPath: string): string | undefined => {
	let folder = dirname(sessionPath)

	while (dirname(folder) !== folder) {
		if (sessionFolders.has(basename(folder))) {
			return join(dirname(folder), 'session_index.jsonl')
		}

		folder = dirname(folder)
	}

	return undefined
}

interface LoadedIndex {
	readonly stamp: string
	readonly names: ReadonlyMap<string, string>
}

/**
 * Codex thread names (from `/rename` or Codex's own naming), read from `session_index.jsonl` and
 * re-read only when that file changes. Session files are never touched for this.
 */
export class CodexThreadNames {
	private readonly indexes = new Map<string, LoadedIndex>()

	/** Loads (or refreshes) the index next to a session file. */
	async load(sessionPath: string): Promise<void> {
		const indexPath = codexIndexPath(sessionPath)

		if (indexPath === undefined) {
			return
		}

		const info = await stat(indexPath).catch(() => undefined)
		const stamp = info === undefined ? '' : `${info.size}\u0000${info.mtimeMs}`

		if (this.indexes.get(indexPath)?.stamp === stamp) {
			return
		}

		const text = info === undefined ? '' : await readFile(indexPath, 'utf8').catch(() => '')
		this.indexes.set(indexPath, { stamp, names: codexThreadNames(jsonLines(text)) })
	}

	/** Loads the indexes for these session files, once each. */
	async loadAll(sessionPaths: ReadonlyArray<string>): Promise<void> {
		const byIndex = new Map(sessionPaths.map((path) => [codexIndexPath(path), path]))
		await Promise.all([...byIndex.values()].map(async (path) => this.load(path)))
	}

	/** The loaded name for a session, if Codex has one. */
	get(sessionPath: string, sessionId: string): string | undefined {
		const indexPath = codexIndexPath(sessionPath)

		const name =
			indexPath === undefined
				? undefined
				: this.indexes.get(indexPath)?.names.get(sessionId.toLowerCase())

		return name === undefined || name === '' ? undefined : name
	}
}
