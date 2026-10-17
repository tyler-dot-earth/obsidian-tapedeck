import { basename } from 'node:path'

import {
	disposePluginRuntime,
	makePluginRuntime,
	type PluginDataStore,
	pluginDataStoreLayerFromHost,
} from '@tyler.earth/effect-obsidian'
import { Effect, Layer, Logger, type ManagedRuntime } from 'effect'
import { debounce, normalizePath, Notice, Plugin } from 'obsidian'

import {
	AutoImportRunner,
	autoImportTickMs,
	isAutoImportCandidate,
	isModifiedSince,
	withLastRun,
} from '#/src/tapedeck-auto-import'
import { CodexThreadNames } from '#/src/tapedeck-codex-names'
import { mapWithLimit } from '#/src/tapedeck-concurrency'
import { tapedeckErrorMessage } from '#/src/tapedeck-errors'
import { TapedeckImporter, type ImportOutcome } from '#/src/tapedeck-importer'
import { type FileChoice, ImportFileModal } from '#/src/tapedeck-modals'
import { ChangeSignal } from '#/src/tapedeck-note-index'
import {
	type TapedeckPluginSettings,
	defaultTapedeckPluginSettings,
	loadTapedeckPluginSettings,
	resolveTapedeckSettings,
	withTapeShelves,
} from '#/src/tapedeck-plugin-settings'
import type { TapePreview } from '#/src/tapedeck-preview'
import { importSummary, noteToOpen, type TapeImportResult } from '#/src/tapedeck-rack-list'
import { listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { TapedeckSettingTab } from '#/src/tapedeck-setting-tab'
import { type ShelfPick, ShelfSuggestModal } from '#/src/tapedeck-shelf-modals'
import { expandHome, shelfName, type TapeShelf } from '#/src/tapedeck-shelves'
import { decodeTapeCache, encodeTapeCache, tapeCacheFileName } from '#/src/tapedeck-tape-cache-file'
import { TapeInfoCache } from '#/src/tapedeck-tape-info'
import type { NoteLookup } from '#/src/tapedeck-tape-list'
import { TapePickerModal } from '#/src/tapedeck-tape-picker'
import { tapeRackViewType, TapeRackView } from '#/src/tapedeck-tape-rack'

/** Quiet time after the last tape read before the tape cache file is saved. */
const tapeCacheSaveMs = 5000

/** Longest wait for an idle moment before the startup auto-import check runs anyway. */
const startupIdleMs = 10_000

/** Vault writes in flight when importing many tapes at once. */
const importConcurrency = 4

export default class TapedeckPlugin extends Plugin {
	override settings: TapedeckPluginSettings = defaultTapedeckPluginSettings
	private runtime: ManagedRuntime.ManagedRuntime<PluginDataStore, never> | undefined
	private readonly threadNames = new CodexThreadNames()
	private readonly tapeInfo = new TapeInfoCache(this.threadNames)
	private readonly importer = new TapedeckImporter(
		this.app,
		() => resolveTapedeckSettings(this.settings),
		this.threadNames,
	)

	/** Loads the tape cache file once, before the first listing. */
	private tapeCacheLoad: Promise<void> | undefined

	/** Saves the tape cache file a few seconds after tapes stop being read. */
	private readonly saveTapeCache = debounce(
		() => {
			void this.writeTapeCache().catch(() => undefined)
		},
		tapeCacheSaveMs,
		true,
	)

	/** Fires when a Tapedeck note is added, changed, renamed, or deleted. */
	private readonly notesChanged = new ChangeSignal()

	private readonly autoImport = new AutoImportRunner<TapeImportResult>({
		shelves: (): ReadonlyArray<TapeShelf> => resolveTapedeckSettings(this.settings).tapeShelves,
		runShelf: async (shelf): Promise<ReadonlyArray<TapeImportResult>> =>
			this.autoImportShelf(shelf),
		markRun: async (shelves, at): Promise<void> => this.markAutoImportRun(shelves, at),
		report: (results): void => {
			new Notice(importSummary(results, '⏰ Tapedeck auto-import'))
		},
	})

	override async onload(): Promise<void> {
		const runtime = makePluginRuntime(
			Layer.mergeAll(
				pluginDataStoreLayerFromHost({
					loadData: () => this.loadData(),
					saveData: (data) => this.saveData(data),
				}),
				Logger.layer([Logger.consolePretty({ mode: 'browser' })]),
			),
		)

		this.runtime = runtime
		this.settings = await runtime.runPromise(loadTapedeckPluginSettings)
		this.addSettingTab(new TapedeckSettingTab(this.app, this, this))
		this.registerCommands()
		this.registerTapeRack()
		this.watchNotes()
		this.register(this.tapeInfo.changed.on(() => this.saveTapeCache()))
		this.app.workspace.onLayoutReady(() => {
			this.startAutoImport()
		})
	}

	/**
	 * Keeps the importer's session index in step with the vault one note at a time, and tells the
	 * rack only when a Tapedeck note changed. The index is rebuilt once, after the metadata cache
	 * finishes its first pass, in case it was built from a partial cache.
	 */
	private watchNotes(): void {
		const changed = (touched: boolean): void => {
			if (touched) {
				this.notesChanged.trigger()
			}
		}

		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				changed(this.importer.noteChanged(file))
			}),
		)

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				changed(this.importer.noteDeleted(file))
			}),
		)

		this.registerEvent(
			this.app.vault.on('rename', (file) => {
				changed(this.importer.isIndexedNote(file))
			}),
		)

		const firstPass = this.app.metadataCache.on('resolved', () => {
			this.app.metadataCache.offref(firstPass)
			this.importer.forgetNotes()
			this.notesChanged.trigger()
		})

		this.registerEvent(firstPass)
	}

	/**
	 * Checks once a minute, while Obsidian is open, for shelves whose auto-import is due. The first
	 * check runs once startup is idle, so a run missed while Obsidian was closed catches up only if
	 * due. With no shelf on auto-import a check reads nothing.
	 */
	private startAutoImport(): void {
		const tick = (): void => {
			void this.autoImport.tick(Date.now()).catch(() => undefined)
		}

		window.requestIdleCallback(tick, { timeout: startupIdleMs })
		this.registerInterval(window.setInterval(tick, autoImportTickMs))
	}

	/** New and changed sessions on a shelf modified after its auto-import was turned on. */
	private async autoImportShelf(shelf: TapeShelf): Promise<ReadonlyArray<TapeImportResult>> {
		const since = shelf.autoImportSince ?? Date.now()
		await this.loadTapeCache()
		const listed = await Effect.runPromise(listSessionFiles([shelf])).catch(() => [])
		const files = listed.filter((file) => isModifiedSince(file.modifiedAt, since))

		if (files.length === 0) {
			return []
		}

		await this.tapeInfo.prepare(files).catch(() => undefined)
		const notes = this.importer.importedNotes()

		const picked = await mapWithLimit(files, importConcurrency, async (file) => {
			const info = await this.tapeInfo.read(file).catch(() => undefined)

			return isAutoImportCandidate(this.tapeInfo.row(file, info, notes), since) ? [file] : []
		})

		return mapWithLimit(picked.flat(), importConcurrency, async (file) => this.importOne(file))
	}

	private async markAutoImportRun(shelves: ReadonlyArray<TapeShelf>, at: number): Promise<void> {
		const current = resolveTapedeckSettings(this.settings).tapeShelves
		const stamped = shelves.reduce((list, shelf) => withLastRun(list, shelf, at), current)
		this.settings = withTapeShelves(this.settings, stamped)
		await this.saveTapedeckPluginSettings()
	}

	private registerTapeRack(): void {
		this.registerView(
			tapeRackViewType,
			(leaf) =>
				new TapeRackView(leaf, {
					listTapes: async (): Promise<ReadonlyArray<SessionFile>> => this.listShelfTapes(),
					cache: this.tapeInfo,
					notes: (): NoteLookup => this.importer.importedNotes(),
					watchNotes: (listener): (() => void) => this.notesChanged.on(listener),
					importTapes: async (files): Promise<ReadonlyArray<TapeImportResult>> =>
						this.importAndReport(files),
					openNote: async (path): Promise<void> => this.openNote(path),
					preview: async (file): Promise<TapePreview> => this.importer.preview(file),
				}),
		)

		this.addRibbonIcon('cassette-tape', 'Open tape rack', () => {
			void this.openTapeRack()
		})

		this.addCommand({
			id: 'open-tape-rack',
			name: '📼 Open tape rack',
			callback: () => {
				void this.openTapeRack()
			},
		})
	}

	/** Reveals the tape rack, opening it in the right sidebar the first time. */
	private async openTapeRack(): Promise<void> {
		const { workspace } = this.app
		const leaf = workspace.getLeavesOfType(tapeRackViewType)[0] ?? workspace.getRightLeaf(false)

		if (leaf === null) {
			return
		}

		await leaf.setViewState({ type: tapeRackViewType, active: true })
		await workspace.revealLeaf(leaf)
	}

	/** Where the tape cache lives: the plugin's own folder in this vault. */
	private tapeCachePath(): string | undefined {
		const folder = this.manifest.dir

		return folder === undefined ? undefined : normalizePath(`${folder}/${tapeCacheFileName}`)
	}

	/** Restores titles and projects read in earlier sessions, once, before anything is listed. */
	private async loadTapeCache(): Promise<void> {
		this.tapeCacheLoad ??= this.readTapeCache()

		await this.tapeCacheLoad
	}

	private async readTapeCache(): Promise<void> {
		const path = this.tapeCachePath()
		const { adapter } = this.app.vault

		if (path === undefined || !(await adapter.exists(path).catch(() => false))) {
			return
		}

		const text = await adapter.read(path).catch(() => undefined)
		this.tapeInfo.restore(decodeTapeCache(text))
	}

	private async writeTapeCache(): Promise<void> {
		const path = this.tapeCachePath()

		if (path === undefined || this.tapeCacheLoad === undefined) {
			return
		}

		await this.tapeCacheLoad
		await this.app.vault.adapter.write(path, encodeTapeCache(this.tapeInfo.snapshot()))
	}

	private async listShelfTapes(): Promise<ReadonlyArray<SessionFile>> {
		const { tapeShelves } = resolveTapedeckSettings(this.settings)
		await this.loadTapeCache()

		const files = await Effect.runPromise(listSessionFiles(tapeShelves)).catch(() => [])
		await this.tapeInfo.prepare(files).catch(() => undefined)

		return files
	}

	/** Opens a note in the current tab, or in a new tab after an import. */
	private async openNote(path: string, where: 'here' | 'tab' = 'here'): Promise<void> {
		const file = this.app.vault.getFileByPath(path)

		if (file !== null) {
			await this.app.workspace.getLeaf(where === 'tab' ? 'tab' : false).openFile(file)
		}
	}

	/** One tape imports and opens its note in a new tab; several import with one summary notice. */
	private async importTapes(files: ReadonlyArray<SessionFile>): Promise<void> {
		const [only] = files

		if (files.length === 1 && only !== undefined) {
			await this.run(this.importer.importFile(only.path, only.source))

			return
		}

		if (files.length > 1) {
			await this.importAndReport(files)
		}
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'import-session-file',
			name: '⏏️ Import session file',
			callback: () => {
				this.openImportFile()
			},
		})

		this.addCommand({
			id: 'import-from-shelves',
			name: '📼 Import from tape shelves',
			callback: () => {
				const { tapeShelves } = resolveTapedeckSettings(this.settings)

				new ShelfSuggestModal(this.app, tapeShelves, (pick) => {
					void this.pickShelf(pick, tapeShelves)
				}).open()
			},
		})

		this.addCommand({
			id: 'reimport-current-transcript',
			name: '⏪ Re-import current transcript',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile()

				const isTranscript =
					file !== null && this.importer.transcriptFrontmatter(file) !== undefined

				if (checking || !isTranscript) {
					return isTranscript
				}

				void this.run(this.importer.reimport(file), 'stay')

				return true
			},
		})
	}

	private openImportFile(): void {
		new ImportFileModal(this.app, (choice) => {
			void this.importChoice(choice)
		}).open()
	}

	private async pickShelf(pick: ShelfPick, shelves: ReadonlyArray<TapeShelf>): Promise<void> {
		if (pick.kind === 'file') {
			this.openImportFile()

			return
		}

		await (pick.kind === 'all'
			? this.pickTapes(shelves, 'your enabled tape shelves')
			: this.pickTapes([{ ...pick.shelf, enabled: true }], shelfName(pick.shelf)))
	}

	private async importChoice(choice: FileChoice): Promise<void> {
		await (choice.kind === 'path'
			? this.run(this.importer.importFile(expandHome(choice.path), undefined))
			: this.run(this.importer.importText(choice.text, undefined, choice.name)))
	}

	private async pickTapes(shelves: ReadonlyArray<TapeShelf>, where: string): Promise<void> {
		await this.loadTapeCache()
		const files = await Effect.runPromise(listSessionFiles(shelves)).catch(() => [])
		await this.tapeInfo.prepare(files).catch(() => undefined)

		if (files.length === 0) {
			new Notice(`📺 Tapedeck: no tapes found on ${where} (check Tape shelves in settings).`)

			return
		}

		new TapePickerModal(this.app, {
			where,
			files,
			cache: this.tapeInfo,
			notes: this.importer.importedNotes(),
			onImport: (chosen): void => {
				void this.importTapes(chosen)
			},
		}).open()
	}

	/**
	 * Imports tapes, reporting every result: a clickable notice for one tape, a summary for several.
	 * A single imported tape opens in a new tab; several open nothing. Failures never pass silently.
	 */
	private async importAndReport(
		files: ReadonlyArray<SessionFile>,
	): Promise<ReadonlyArray<TapeImportResult>> {
		if (files.length > 1) {
			new Notice(`⏯️ Tapedeck: importing ${files.length} tapes…`)
		}

		const results = await mapWithLimit(files, importConcurrency, async (file) =>
			this.importOne(file),
		)

		this.announce(results)
		const single = noteToOpen(results)

		if (single !== undefined) {
			await this.openNote(single, 'tab')
		}

		return results
	}

	private async importOne(file: SessionFile): Promise<TapeImportResult> {
		try {
			const outcome = await this.importer.importFile(file.path, file.source)

			return {
				path: file.path,
				ok: true,
				notePath: outcome.file.path,
				title: outcome.transcript.title,
				updated: outcome.updated,
			}
		} catch (error) {
			return { path: file.path, ok: false, message: tapedeckErrorMessage(error) }
		}
	}

	private announce(results: ReadonlyArray<TapeImportResult>): void {
		const [only] = results

		if (results.length !== 1 || only === undefined) {
			new Notice(importSummary(results))

			return
		}

		if (!only.ok) {
			new Notice(`⏹️ Tapedeck: couldn't import ${basename(only.path)}: ${only.message}`)

			return
		}

		const verb = only.updated ? '⏪ Updated' : '⏏️ Imported'
		const notice = new Notice(`${verb} ${only.title}`)
		notice.messageEl.addClass('tapedeck-notice-link')
		notice.messageEl.setAttr('aria-label', 'Open the note')

		notice.messageEl.addEventListener('click', () => {
			void this.openNote(only.notePath)
		})
	}

	/**
	 * Runs one import with a notice. The note opens in a new tab, except when re-importing the note
	 * already in front of you (`stay`).
	 */
	private async run(task: Promise<ImportOutcome>, open: 'tab' | 'stay' = 'tab'): Promise<void> {
		try {
			const outcome = await task
			const verb = outcome.updated ? '⏪ Updated' : '⏏️ Imported'
			new Notice(`${verb} ${outcome.file.basename}`)

			if (open === 'tab') {
				await this.app.workspace.getLeaf('tab').openFile(outcome.file)
			}
		} catch (error) {
			new Notice(`⏹️ Tapedeck: ${tapedeckErrorMessage(error)}`)
		}
	}

	async saveTapedeckPluginSettings(): Promise<void> {
		await this.saveData(this.settings)
	}

	override onunload(): void {
		this.saveTapeCache.run()
		void disposePluginRuntime(this.runtime)
		this.runtime = undefined
	}
}
