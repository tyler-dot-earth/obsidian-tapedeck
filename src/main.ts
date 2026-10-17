import {
	disposePluginRuntime,
	makePluginRuntime,
	type PluginDataStore,
	pluginDataStoreLayerFromHost,
} from '@tyler.earth/effect-obsidian'
import { Effect, Layer, Logger, type ManagedRuntime } from 'effect'
import { Notice, Plugin } from 'obsidian'

import { tapedeckErrorMessage } from '#/src/tapedeck-errors'
import { TapedeckImporter, type ImportOutcome } from '#/src/tapedeck-importer'
import {
	type FileChoice,
	ImportFileModal,
	type SessionChoice,
	SessionSuggestModal,
	SourceSuggestModal,
} from '#/src/tapedeck-modals'
import {
	type TapedeckPluginSettings,
	defaultTapedeckPluginSettings,
	loadTapedeckPluginSettings,
	resolveTapedeckSettings,
} from '#/src/tapedeck-plugin-settings'
import { sessionChoice } from '#/src/tapedeck-session-choice'
import { listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { TapedeckSettingTab } from '#/src/tapedeck-setting-tab'
import { expandHome } from '#/src/tapedeck-shelves'
import { transcriptSources } from '#/src/tapedeck-sources'
import type { TranscriptSource } from '#/src/tapedeck-transcript'

export default class TapedeckPlugin extends Plugin {
	override settings: TapedeckPluginSettings = defaultTapedeckPluginSettings
	private runtime: ManagedRuntime.ManagedRuntime<PluginDataStore, never> | undefined
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
				new ImportFileModal(this.app, (choice) => {
					void this.importChoice(choice)
				}).open()
			},
		})

		this.addCommand({
			id: 'import-recent-sessions',
			name: '📼 Import recent sessions',
			callback: () => {
				new SourceSuggestModal(this.app, (source) => {
					void this.pickRecent(source === 'all' ? transcriptSources : [source])
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

	private async importChoice(choice: FileChoice): Promise<void> {
		await (choice.kind === 'path'
			? this.run(this.importer.importFile(expandHome(choice.path), undefined))
			: this.run(this.importer.importText(choice.text, undefined, choice.name)))
	}

	private async pickRecent(sources: ReadonlyArray<TranscriptSource>): Promise<void> {
		const settings = resolveTapedeckSettings(this.settings)
		const listed = await Effect.runPromise(listSessionFiles(settings.tapeShelves)).catch(() => [])
		const files = listed.filter((file) => sources.includes(file.source))
		const recent = files.slice(0, Math.max(1, settings.recentCount))

		if (recent.length === 0) {
			new Notice('📺 Tapedeck: no tapes found. Check the source folders in settings.')

			return
		}

		const choices: Array<SessionChoice> = [
			{ label: `⏯️ Import all ${recent.length} listed tapes`, file: undefined },
			...(await Promise.all(recent.map(sessionChoice))),
		]

		new SessionSuggestModal(this.app, choices, (choice) => {
			void (choice.file === undefined
				? this.importMany(recent)
				: this.run(this.importer.importFile(choice.file.path, choice.file.source)))
		}).open()
	}

	private async importMany(files: ReadonlyArray<SessionFile>): Promise<void> {
		const outcomes = await Promise.all(
			files.map((file) => this.importer.importFile(file.path, file.source).catch(() => undefined)),
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
