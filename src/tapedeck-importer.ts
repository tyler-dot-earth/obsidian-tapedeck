import { hostname, homedir } from 'node:os'
import { basename } from 'node:path'

import { Effect, Option, Result, Schema } from 'effect'
import { type App, normalizePath, TFile } from 'obsidian'

import type { TapedeckParseError } from '#/src/tapedeck-errors'
import { parseTimestamp, transcriptFilename } from '#/src/tapedeck-filename'
import { resolveImages } from '#/src/tapedeck-image-import'
import type { ResolvedTapedeckSettings } from '#/src/tapedeck-plugin-settings'
import { type PreviousNote, renderTranscriptNote } from '#/src/tapedeck-render'
import { listSessionFiles, readSessionFile } from '#/src/tapedeck-session-files'
import { detectSource, sourceFor } from '#/src/tapedeck-sources'
import type { ImportedNote, NoteLookup } from '#/src/tapedeck-tape-list'
import type { Harness, Transcript, TranscriptSource } from '#/src/tapedeck-transcript'

/** Frontmatter Tapedeck reads back from notes it wrote. */
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

/** Import times Tapedeck writes, as local `YYYY-MM-DDTHH:mm:ss`. */
const ImportTimes = Schema.Struct({
	created: Schema.optionalKey(Schema.String),
	updated: Schema.optionalKey(Schema.String),
})

/** What happened to one session. */
export interface ImportOutcome {
	readonly file: TFile
	readonly transcript: Transcript
	readonly updated: boolean
}

export type ParsedSession = Result.Result<Transcript, TapedeckParseError | 'unknown-format'>

/** Parses session text with the given source, or detects the source from the first lines. */
export const parseSession = (text: string, source: TranscriptSource | undefined): ParsedSession => {
	const chosen = source ?? detectSource(text)

	return chosen === undefined ? Result.fail('unknown-format') : chosen.parse(text)
}

/** Vault side of an import: find, create, or update transcript notes. */
export class TapedeckImporter {
	private readonly app: App
	private readonly settings: () => ResolvedTapedeckSettings

	constructor(app: App, settings: () => ResolvedTapedeckSettings) {
		this.app = app
		this.settings = settings
	}

	/** Frontmatter of a Tapedeck note, if the file is one. */
	transcriptFrontmatter(file: TFile): TranscriptFrontmatter | undefined {
		const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter

		return Option.getOrUndefined(Schema.decodeUnknownOption(TranscriptFrontmatter)(frontmatter))
	}

	/**
	 * Note lookup for the picker and the tape rack. Reads every note's frontmatter once, from the
	 * metadata cache, so thousands of tapes can be checked cheaply. `updated` (or `created`) is the
	 * local time of the last import.
	 */
	importedNotes(): NoteLookup {
		const notes = new Map<string, ImportedNote>()

		for (const file of this.app.vault.getMarkdownFiles()) {
			const frontmatter = this.transcriptFrontmatter(file)

			if (frontmatter !== undefined) {
				notes.set(`${frontmatter.harness}\u0000${frontmatter.session_id.toLowerCase()}`, {
					path: file.path,
					importedAt: this.importedAt(file),
				})
			}
		}

		return (harness, sessionId) => notes.get(`${harness}\u0000${sessionId.toLowerCase()}`)
	}

	private importedAt(file: TFile): Date | undefined {
		const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter
		const kept = Option.getOrUndefined(Schema.decodeUnknownOption(ImportTimes)(frontmatter))

		return parseTimestamp(kept?.updated ?? kept?.created)
	}

	/** Existing note for a session, so imports update instead of duplicating. */
	findNote(harness: Harness, sessionId: string): TFile | undefined {
		return this.app.vault.getMarkdownFiles().find((file) => {
			const frontmatter = this.transcriptFrontmatter(file)

			return frontmatter?.session_id === sessionId && frontmatter.harness === harness
		})
	}

	/** Writes a transcript note, updating the existing note for the same session. */
	async writeTranscript(parsed: Transcript): Promise<ImportOutcome> {
		const settings = this.settings()
		const existing = this.findNote(parsed.harness, parsed.sessionId)
		const notePath = existing?.path ?? (await this.freePath(parsed))

		const transcript = await resolveImages(parsed, {
			enabled: settings.importImages,
			maxBytes: Math.max(0, settings.maxImageMB) * 1024 * 1024,
			sessionId: parsed.sessionId,
			save: (name, bytes) => this.saveAttachment(name, bytes, notePath),
		})

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

		const file = await this.app.vault.create(notePath, markdown)

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
		const files = await Effect.runPromise(listSessionFiles(this.settings().tapeShelves))

		const match = files.find(
			(session) =>
				session.source.harness === source.harness &&
				basename(session.path).includes(frontmatter.session_id),
		)

		if (match === undefined) {
			throw new Error(
				`No ${source.label} session file for ${frontmatter.session_id} on your tape shelves`,
			)
		}

		return this.importFile(match.path, source)
	}

	/**
	 * Saves an image where Obsidian's attachment setting says, for the note at `notePath`. The name
	 * is deterministic, so when a file of that name is already in the attachment folder (an earlier
	 * import) it is reused rather than saved again as `name 1.png`. Returns the embed.
	 */
	private async saveAttachment(name: string, bytes: Uint8Array, notePath: string): Promise<string> {
		const available = await this.app.fileManager.getAvailablePathForAttachment(name, notePath)
		const slash = available.lastIndexOf('/')
		const wanted = normalizePath(slash === -1 ? name : `${available.slice(0, slash)}/${name}`)

		const file =
			this.app.vault.getFileByPath(wanted) ??
			(await this.app.vault.createBinary(wanted, Uint8Array.from(bytes).buffer))

		return `!${this.app.fileManager.generateMarkdownLink(file, notePath)}`
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
