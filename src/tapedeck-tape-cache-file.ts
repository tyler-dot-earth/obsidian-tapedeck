import { Option, Schema } from 'effect'

import type { TapeInfo } from '#/src/tapedeck-tape-info'

/**
 * The tape cache file: what was read from each tape, keyed by path, size, and mtime, so a cold
 * start shows titles and projects without re-reading every tape. It is runtime data in the vault's
 * plugin folder (it holds titles and paths from your sessions), never part of the repo.
 */
export const tapeCacheFileName = 'tape-cache.json'

const CachedTape = Schema.Struct({
	key: Schema.String,
	title: Schema.String,
	titleSource: Schema.Literals(['name', 'prompt', 'fallback']),
	kind: Schema.Literals(['session', 'subagent', 'empty', 'unreadable']),
	cwd: Schema.optional(Schema.String),
	sessionId: Schema.optional(Schema.String),
	project: Schema.optional(Schema.String),
	worktree: Schema.optional(Schema.String),
})

type CachedTape = Schema.Schema.Type<typeof CachedTape>

const TapeCacheFile = Schema.Struct({
	version: Schema.Literal(1),
	tapes: Schema.Array(CachedTape),
})

/** One cached tape: its cache key and what was read. */
export interface CacheEntry {
	readonly key: string
	readonly info: TapeInfo
}

const toCached = ({ key, info }: CacheEntry): CachedTape => ({
	key,
	title: info.title,
	titleSource: info.titleSource,
	kind: info.kind,
	cwd: info.cwd,
	sessionId: info.sessionId,
	project: info.place?.project,
	worktree: info.place?.worktree,
})

const fromCached = (tape: CachedTape): CacheEntry => ({
	key: tape.key,
	info: {
		title: tape.title,
		titleSource: tape.titleSource,
		kind: tape.kind,
		cwd: tape.cwd,
		sessionId: tape.sessionId,
		place:
			tape.project === undefined ? undefined : { project: tape.project, worktree: tape.worktree },
	},
})

/** The cache file's text for these entries. */
export const encodeTapeCache = (entries: ReadonlyArray<CacheEntry>): string =>
	JSON.stringify({ version: 1, tapes: entries.map(toCached) })

/** Entries from a cache file; a missing, old, or damaged file gives none, so tapes are re-read. */
export const decodeTapeCache = (text: string | undefined): ReadonlyArray<CacheEntry> => {
	if (text === undefined || text === '') {
		return []
	}

	const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(TapeCacheFile))(text)

	return Option.match(decoded, {
		onNone: () => [],
		onSome: (file) => file.tapes.map(fromCached),
	})
}
