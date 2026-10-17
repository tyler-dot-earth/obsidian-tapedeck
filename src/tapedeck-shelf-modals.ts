import { type App, FuzzySuggestModal, Modal, Notice, Setting } from 'obsidian'

import { isShelfAvailable } from '#/src/tapedeck-session-files'
import { ShelfHarness, shelfHarnessLabels, shelfName, type TapeShelf } from '#/src/tapedeck-shelves'
import { sourceFor } from '#/src/tapedeck-sources'

/** Emoji for a shelf: its harness, or a TV for auto-detect shelves. */
export const shelfEmoji = (shelf: TapeShelf): string =>
	shelf.harness === 'auto' ? '📺' : sourceFor(shelf.harness).emoji

/** One line about a shelf: harness, folder, and whether the folder is there. */
export const shelfSummary = (shelf: TapeShelf): string => {
	const parts = [shelfHarnessLabels[shelf.harness], shelf.path]

	return isShelfAvailable(shelf)
		? parts.join(' · ')
		: [...parts, 'folder not found, skipped'].join(' · ')
}

/** Adds or edits one tape shelf. Hands back the new shelf on save. */
export class ShelfEditModal extends Modal {
	private readonly onSave: (shelf: TapeShelf) => void
	private readonly isNew: boolean
	private draft: TapeShelf

	constructor(app: App, shelf: TapeShelf | undefined, onSave: (shelf: TapeShelf) => void) {
		super(app)
		this.onSave = onSave
		this.isNew = shelf === undefined
		this.draft = shelf ?? { path: '', label: '', harness: 'auto', enabled: true }
	}

	override onOpen(): void {
		this.setTitle(this.isNew ? '📼 Add a tape shelf' : '📼 Edit tape shelf')

		new Setting(this.contentEl)
			.setName('Label')
			.setDesc('Optional name shown instead of the folder.')
			.addText((text) =>
				text
					.setPlaceholder('Work laptop sessions')
					.setValue(this.draft.label ?? '')
					.onChange((value) => {
						this.draft = { ...this.draft, label: value }
					}),
			)

		new Setting(this.contentEl)
			.setClass('tapedeck-import-path')
			.setName('Folder')
			.setDesc('Folder of .jsonl session files (~ is your home folder).')
			.addText((text) =>
				text
					.setPlaceholder('~/path/to/sessions')
					.setValue(this.draft.path)
					.onChange((value) => {
						this.draft = { ...this.draft, path: value }
					}),
			)

		new Setting(this.contentEl)
			.setName('Agent')
			.setDesc('Which agent wrote these tapes (Auto-detect reads each file).')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(shelfHarnessLabels)
					.setValue(this.draft.harness)
					.onChange((value) => {
						this.setHarness(value)
					}),
			)

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText(this.isNew ? 'Add shelf' : 'Save')
				.setCta()
				.onClick(() => {
					this.save()
				}),
		)
	}

	private setHarness(value: string): void {
		const harness = ShelfHarness.literals.find((literal) => literal === value)

		if (harness !== undefined) {
			this.draft = { ...this.draft, harness }
		}
	}

	private save(): void {
		const path = this.draft.path.trim()

		if (path === '') {
			new Notice('📼 Tapedeck: a shelf needs a folder.')

			return
		}

		const label = this.draft.label?.trim() ?? ''
		const shelf = { path, harness: this.draft.harness, enabled: this.draft.enabled }
		this.close()
		this.onSave(label === '' ? shelf : { ...shelf, label })
	}

	override onClose(): void {
		this.contentEl.empty()
	}
}

/** What the import picker hands back. */
export type ShelfPick =
	| { readonly kind: 'all' }
	| { readonly kind: 'shelf'; readonly shelf: TapeShelf }
	| { readonly kind: 'file' }

/**
 * Picks where to import from: every enabled shelf, one shelf (enabled or not), or a one-off file.
 * Shelves whose folder is missing stay in the list, marked unavailable.
 */
export class ShelfSuggestModal extends FuzzySuggestModal<ShelfPick> {
	private readonly shelves: ReadonlyArray<TapeShelf>
	private readonly onChoose: (pick: ShelfPick) => void

	constructor(app: App, shelves: ReadonlyArray<TapeShelf>, onChoose: (pick: ShelfPick) => void) {
		super(app)
		this.shelves = shelves
		this.onChoose = onChoose
		this.setPlaceholder('📼 Which shelf?')
	}

	override getItems(): Array<ShelfPick> {
		const ordered = [
			...this.shelves.filter((shelf) => shelf.enabled),
			...this.shelves.filter((shelf) => !shelf.enabled),
		]

		return [
			{ kind: 'all' },
			...ordered.map((shelf): ShelfPick => ({ kind: 'shelf', shelf })),
			{ kind: 'file' },
		]
	}

	override getItemText(item: ShelfPick): string {
		if (item.kind === 'shelf') {
			return shelfPickText(item.shelf)
		}

		if (item.kind === 'file') {
			return '⏏️ One-off file…'
		}

		return `📼 All enabled shelves (${this.shelves.filter((shelf) => shelf.enabled).length})`
	}

	override onChooseItem(item: ShelfPick): void {
		this.onChoose(item)
	}
}

const shelfPickText = (shelf: TapeShelf): string => {
	const notes = [
		...(shelf.enabled ? [] : ['off']),
		...(isShelfAvailable(shelf) ? [] : ['unavailable']),
	]

	const suffix = notes.length === 0 ? '' : ` (${notes.join(', ')})`

	return `${shelfEmoji(shelf)} ${shelfName(shelf)}${suffix}`
}
