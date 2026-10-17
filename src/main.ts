import {
	disposePluginRuntime,
	makePluginRuntime,
	type PluginDataStore,
	pluginDataStoreLayerFromHost,
} from '@tyler.earth/effect-obsidian'
import { Effect, Layer, Logger, type ManagedRuntime } from 'effect'
import { Notice, Plugin } from 'obsidian'

import { mapWithLimit } from '#/src/tapedeck-concurrency'
import { tapedeckErrorMessage } from '#/src/tapedeck-errors'
import { TapedeckImporter, type ImportOutcome } from '#/src/tapedeck-importer'
import { type FileChoice, ImportFileModal } from '#/src/tapedeck-modals'
import {
	type TapedeckPluginSettings,
	defaultTapedeckPluginSettings,
	loadTapedeckPluginSettings,
	resolveTapedeckSettings,
} from '#/src/tapedeck-plugin-settings'
import { listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { TapedeckSettingTab } from '#/src/tapedeck-setting-tab'
import { type ShelfPick, ShelfSuggestModal } from '#/src/tapedeck-shelf-modals'
import { expandHome, shelfName, type TapeShelf } from '#/src/tapedeck-shelves'
import { TapeInfoCache } from '#/src/tapedeck-tape-info'
import { TapePickerModal } from '#/src/tapedeck-tape-picker'

/** Vault writes in flight when importing many tapes at once. */
const importConcurrency = 4

export default class TapedeckPlugin extends Plugin {
	override settings: TapedeckPluginSettings = defaultTapedeckPluginSettings
	private runtime: ManagedRuntime.ManagedRuntime<PluginDataStore, never> | undefined
	private readonly tapeInfo = new TapeInfoCache()
	private readonly importer = new TapedeckImporter(this.app, () =>
		resolveTapedeckSettings(this.settings),
	)

	override async onload(): Promise<void> {
		const runtime = makePluginRuntime(
			Layer.mergeAll(
				pluginDataStoreLayerFromHost({
					loadData: () => this.loadData(),
					saveData: (data) => this.saveData(data),
				}),
				Logger.layer([Logger.consoleJson]),
			),
		)

		this.runtime = runtime
		this.settings = await runtime.runPromise(loadTapedeckPluginSettings)
		this.addSettingTab(new TapedeckSettingTab(this.app, this, this))
		this.registerCommands()
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
			id: 'import-recent-sessions',
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

				void this.run(this.importer.reimport(file))

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
		const files = await Effect.runPromise(listSessionFiles(shelves)).catch(() => [])

		if (files.length === 0) {
			new Notice(`📺 Tapedeck: no tapes found on ${where} (check Tape shelves in settings).`)

			return
		}

		new TapePickerModal(this.app, {
			where,
			files,
			cache: this.tapeInfo,
			imported: this.importer.importedSessions(),
			onImport: (chosen): void => {
				const [only] = chosen

				void (chosen.length === 1 && only !== undefined
					? this.run(this.importer.importFile(only.path, only.source))
					: this.importMany(chosen))
			},
		}).open()
	}

	private async importMany(files: ReadonlyArray<SessionFile>): Promise<void> {
		new Notice(`⏯️ Tapedeck: importing ${files.length} tapes…`)

		const outcomes = await mapWithLimit(files, importConcurrency, (file) =>
			this.importer.importFile(file.path, file.source).catch(() => undefined),
		)

		const updated = outcomes.filter((outcome) => outcome?.updated === true).length
		const failed = outcomes.filter((outcome) => outcome === undefined).length
		const imported = outcomes.length - updated - failed
		const skipped = failed > 0 ? `, ${failed} skipped` : ''

		new Notice(`📼 Tapedeck: ${imported} new, ${updated} updated${skipped}.`)
	}

	private async run(task: Promise<ImportOutcome>): Promise<void> {
		try {
			const outcome = await task
			const verb = outcome.updated ? '⏪ Updated' : '⏏️ Imported'
			new Notice(`${verb} ${outcome.file.basename}`)
			await this.app.workspace.getLeaf(false).openFile(outcome.file)
		} catch (error) {
			new Notice(`⏹️ Tapedeck: ${tapedeckErrorMessage(error)}`)
		}
	}

	async saveTapedeckPluginSettings(): Promise<void> {
		await this.saveData(this.settings)
	}

	override onunload(): void {
		void disposePluginRuntime(this.runtime)
		this.runtime = undefined
	}
}
