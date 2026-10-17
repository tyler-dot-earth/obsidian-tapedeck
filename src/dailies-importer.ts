import { hostname, homedir } from 'node:os'
import { basename } from 'node:path'

import { Effect, Option, Result, Schema } from 'effect'
import { type App, normalizePath, TFile } from 'obsidian'

import type { DailiesParseError } from '#/src/dailies-errors'
import { transcriptFilename } from '#/src/dailies-filename'
import type { ResolvedDailiesSettings } from '#/src/dailies-plugin-settings'
import { type PreviousNote, renderTranscriptNote } from '#/src/dailies-render'
import { listSessionFiles, readSessionFile } from '#/src/dailies-session-files'
import { detectSource, sourceFor } from '#/src/dailies-sources'
import type { Harness, Transcript, TranscriptSource } from '#/src/dailies-transcript'

/** Frontmatter Dailies reads back from notes it wrote. */
const TranscriptFrontmatter = Schema.Struct({
	type: Schema.Literal('transcript'),
	harness: Schema.Literals(['claude-code', 'codex', 'pi']),
	session_id: Schema.String,
})

/** Values a re-import keeps. Decoded on their own so odd values do not hide the note. */
const KeptFrontmatter = Schema.Struct({
	created: Schema.optionalKey(Schema.String),
	project: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

type TranscriptFrontmatter = Schema.Schema.Type<typeof TranscriptFrontmatter>

/** What happened to one session. */
export interface ImportOutcome {
	readonly file: TFile
	readonly transcript: Transcript
	readonly updated: boolean
}

export type ParsedSession = Result.Result<Transcript, DailiesParseError | 'unknown-format'>

/** Parses session text with the given source, or detects the source from the first lines. */
export const parseSession = (text: string, source: TranscriptSource | undefined): ParsedSession => {
	const chosen = source ?? detectSource(text)

	return chosen === undefined ? Result.fail('unknown-format') : chosen.parse(text)
}

/** Vault side of an import: find, create, or update transcript notes. */
export class DailiesImporter {
	private readonly app: App
	private readonly settings: () => ResolvedDailiesSettings

	constructor(app: App, settings: () => ResolvedDailiesSettings) {
		this.app = app
		this.settings = settings
	}

	/** Frontmatter of a Dailies note, if the file is one. */
	transcriptFrontmatter(file: TFile): TranscriptFrontmatter | undefined {
		const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter

		return Option.getOrUndefined(Schema.decodeUnknownOption(TranscriptFrontmatter)(frontmatter))
	}

	/** Existing note for a session, so imports update instead of duplicating. */
	findNote(harness: Harness, sessionId: string): TFile | undefined {
		return this.app.vault.getMarkdownFiles().find((file) => {
			const frontmatter = this.transcriptFrontmatter(file)

			return frontmatter?.session_id === sessionId && frontmatter.harness === harness
		})
	}

	/** Writes a transcript note, updating the existing note for the same session. */
	async writeTranscript(transcript: Transcript): Promise<ImportOutcome> {
		const settings = this.settings()
		const existing = this.findNote(transcript.harness, transcript.sessionId)

		const markdown = renderTranscriptNote(transcript, {
			foldToolCalls: settings.foldToolCalls,
			toolOutput: settings.toolOutput,
			truncateLines: settings.truncateLines,
			includeThinking: settings.includeThinking,
			noteStyle: settings.noteStyle,
			machine: hostname(),
			resume: sourceFor(transcript.harness).resumeCommand(transcript),
			importedAt: new Date(),
			redactHome: settings.redactHomePaths ? homedir() : undefined,
			redactSecrets: settings.redactSecrets,
			previous: this.previousNote(existing),
		})

		if (existing !== undefined) {
			await this.app.vault.modify(existing, markdown)

			return { file: existing, transcript, updated: true }
		}

		const file = await this.app.vault.create(await this.freePath(transcript), markdown)

		return { file, transcript, updated: false }
	}

	/** Reads, parses, and writes one session file. */
	async importFile(path: string, source: TranscriptSource | undefined): Promise<ImportOutcome> {
		const text = await Effect.runPromise(readSessionFile(path))

		return this.importText(text, source, basename(path))
	}

	/** Parses and writes session text. Throws a readable error when it cannot. */
	async importText(
		text: string,
		source: TranscriptSource | undefined,
		name: string,
	): Promise<ImportOutcome> {
		const parsed = parseSession(text, source)

		if (Result.isFailure(parsed)) {
			throw new Error(
				parsed.failure === 'unknown-format'
					? `${name} does not look like a Claude Code, Codex, or Pi session`
					: `${name}: ${parsed.failure.message}`,
			)
		}

		return this.writeTranscript(parsed.success)
	}

	/** Finds the session file for a note by its `session_id` and imports it again. */
	async reimport(file: TFile): Promise<ImportOutcome> {
		const frontmatter = this.transcriptFrontmatter(file)

		if (frontmatter === undefined) {
			throw new Error(`${file.basename} has no transcript frontmatter`)
		}

		const source = sourceFor(frontmatter.harness)
		const files = await Effect.runPromise(listSessionFiles([source], this.settings()))
		const match = files.find((session) => basename(session.path).includes(frontmatter.session_id))

		if (match === undefined) {
			throw new Error(`No ${source.label} session file found for ${frontmatter.session_id}`)
		}

		return this.importFile(match.path, source)
	}

	private previousNote(file: TFile | undefined): PreviousNote {
		const frontmatter: unknown =
			file === undefined ? undefined : this.app.metadataCache.getFileCache(file)?.frontmatter

		const kept = Option.getOrUndefined(Schema.decodeUnknownOption(KeptFrontmatter)(frontmatter))

		return { created: kept?.created, project: kept?.project ?? undefined }
	}

	private async freePath(transcript: Transcript): Promise<string> {
		const folder = normalizePath(this.settings().importFolder.trim() || '/')
		await this.ensureFolder(folder)

		const name = transcriptFilename(this.settings().filenamePattern, transcript, new Date())
		const prefix = folder === '/' ? '' : `${folder}/`
		const first = normalizePath(`${prefix}${name}.md`)

		if (this.app.vault.getAbstractFileByPath(first) === null) {
			return first
		}

		return normalizePath(`${prefix}${name} ${transcript.sessionId.slice(0, 8)}.md`)
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (folder === '/' || this.app.vault.getAbstractFileByPath(folder) !== null) {
			return
		}

		await this.app.vault.createFolder(folder).catch(() => undefined)
	}
}
