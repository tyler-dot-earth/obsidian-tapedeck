import { Option, Schema } from 'effect'
import {
	type App,
	Plugin,
	PluginSettingTab,
	type SettingDefinition,
	type SettingDefinitionItem,
} from 'obsidian'

import {
	type TapedeckPluginSettingsHost,
	isTapedeckSettingKey,
	resolveTapedeckSettings,
	withTapedeckSetting,
	withTapeShelves,
} from '#/src/tapedeck-plugin-settings'
import { ShelfEditModal, shelfSummary } from '#/src/tapedeck-shelf-modals'
import { shelfName, type TapeShelf } from '#/src/tapedeck-shelves'

/** Plugin settings tab: where the tapes live, how notes come out, what gets blurred. */
export class TapedeckSettingTab extends PluginSettingTab {
	private readonly settingsHost: TapedeckPluginSettingsHost

	constructor(app: App, plugin: Plugin, settingsHost: TapedeckPluginSettingsHost) {
		super(app, plugin)
		this.settingsHost = settingsHost
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...this.shelfDefinitions(),
			{ name: '🏷️ Notes', desc: 'How a transcript lands in the vault.' },
			{
				name: 'Import folder',
				desc: 'Created if missing.',
				control: { type: 'folder', key: 'importFolder', placeholder: 'Transcripts' },
			},
			{
				name: 'Filename pattern',
				desc: 'Tokens: {date} {time} {harness} {session} {title}.',
				control: { type: 'text', key: 'filenamePattern', placeholder: '{date} {harness} {title}' },
			},
			{
				name: 'Note style',
				desc: 'Raw keeps every tool call; Summary lists tools per turn.',
				control: {
					type: 'dropdown',
					key: 'noteStyle',
					options: { raw: 'Raw', summary: 'Summary' },
				},
			},
			{
				name: 'Fold tool calls',
				desc: 'Tool callouts start collapsed.',
				control: { type: 'toggle', key: 'foldToolCalls' },
			},
			{
				name: 'Tool output',
				desc: 'Full keeps everything; Truncated keeps the first lines.',
				control: {
					type: 'dropdown',
					key: 'toolOutput',
					options: { full: 'Full', truncated: 'Truncated', none: 'None' },
				},
			},
			{
				name: 'Truncate after lines',
				desc: 'Used when tool output is Truncated.',
				control: { type: 'number', key: 'truncateLines', placeholder: '40' },
			},
			{
				name: 'Include thinking',
				desc: 'Keep stored model reasoning in a folded quote.',
				control: { type: 'toggle', key: 'includeThinking' },
			},
			{
				name: '⏸️ Freeze-frames',
				desc: 'Images from tapes, saved to your attachment folder and embedded where they appeared.',
				aliases: ['images', 'screenshots', 'attachments'],
			},
			{
				name: 'Import freeze-frames',
				desc: 'Save images into the vault, or leave a short note where each one was.',
				control: { type: 'toggle', key: 'importImages' },
			},
			{
				name: 'Freeze-frame size limit (MB)',
				desc: 'Bigger images get a note instead (0 means no limit).',
				control: { type: 'number', key: 'maxImageMB', placeholder: '0' },
			},
			{
				name: '✂️ Redaction',
				desc: 'Basic patterns applied to the whole note, not a guarantee.',
			},
			{
				name: 'Home folder as ~',
				desc: 'Rewrite your home directory path to ~.',
				control: { type: 'toggle', key: 'redactHomePaths' },
			},
			{
				name: 'Mask secrets',
				desc: 'API keys, tokens, bearer headers, private keys, and key=value secrets become [REDACTED].',
				control: { type: 'toggle', key: 'redactSecrets' },
			},
		]
	}

	private shelves(): ReadonlyArray<TapeShelf> {
		return resolveTapedeckSettings(this.settingsHost.settings).tapeShelves
	}

	private shelfDefinitions(): SettingDefinitionItem[] {
		const shelves = this.shelves()

		return [
			{
				name: '📼 Tape shelves',
				desc: 'Folders to browse when you import tapes (~ is your home folder).',
				aliases: ['source folders', 'session folders', 'sources'],
			},
			{
				type: 'list',
				heading: 'Shelves',
				emptyState: 'No shelves yet. Add a folder, or restore the defaults.',
				items: shelves.map((shelf, index) => this.shelfRow(shelf, index)),
				onDelete: (index) => {
					this.saveShelves(shelves.filter((_shelf, at) => at !== index))
				},
				onReorder: (from, to) => {
					const moved = shelves.filter((_shelf, at) => at !== from)
					moved.splice(to, 0, ...shelves.slice(from, from + 1))
					this.saveShelves(moved)
				},
				addItem: {
					name: 'Add shelf',
					action: () => {
						new ShelfEditModal(this.app, undefined, (shelf) => {
							this.saveShelves([...this.shelves(), shelf])
						}).open()
					},
				},
			},
			{
				name: 'Restore default shelves',
				desc: 'Replace the list with Claude Code (~/.claude/projects), Codex CLI (~/.codex/sessions), and Pi (~/.pi/agent/sessions).',
				action: () => {
					this.saveShelves(undefined)
				},
			},
		]
	}

	private shelfRow(shelf: TapeShelf, index: number): SettingDefinition {
		return {
			name: shelfName(shelf),
			desc: shelfSummary(shelf),
			aliases: [shelf.path],
			render: (setting) => {
				setting
					.setName(shelfName(shelf))
					.setDesc(shelfSummary(shelf))
					.addExtraButton((button) =>
						button
							.setIcon('pencil')
							.setTooltip('Edit shelf')
							.onClick(() => {
								new ShelfEditModal(this.app, shelf, (edited) => {
									this.replaceShelf(index, edited)
								}).open()
							}),
					)
					.addToggle((toggle) =>
						toggle
							.setTooltip('Import from this shelf')
							.setValue(shelf.enabled)
							.onChange((enabled) => {
								this.replaceShelf(index, { ...shelf, enabled })
							}),
					)
			},
		}
	}

	private replaceShelf(index: number, shelf: TapeShelf): void {
		this.saveShelves(this.shelves().map((current, at) => (at === index ? shelf : current)))
	}

	/** Saves the list (`undefined` restores the defaults) and redraws the rows. */
	private saveShelves(shelves: ReadonlyArray<TapeShelf> | undefined): void {
		this.settingsHost.settings = withTapeShelves(this.settingsHost.settings, shelves)
		void this.settingsHost.saveTapedeckPluginSettings()
		this.update()
	}

	override getControlValue(key: string): unknown {
		if (!isTapedeckSettingKey(key)) {
			return undefined
		}

		return resolveTapedeckSettings(this.settingsHost.settings)[key]
	}

	override setControlValue(key: string, value: unknown): void {
		if (!isTapedeckSettingKey(key)) {
			return
		}

		const json = Schema.decodeUnknownOption(Schema.Json)(
			typeof value === 'string' ? value.trim() : value,
		)

		if (Option.isNone(json)) {
			return
		}

		this.settingsHost.settings = withTapedeckSetting(this.settingsHost.settings, key, json.value)
		void this.settingsHost.saveTapedeckPluginSettings()
	}
}
