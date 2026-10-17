import { type App, ButtonComponent, Modal, Notice } from 'obsidian'

import { mapWithLimit } from '#/src/tapedeck-concurrency'
import type { SessionFile } from '#/src/tapedeck-session-files'
import type { TapeInfo, TapeInfoCache } from '#/src/tapedeck-tape-info'
import {
	allShownSelected,
	clearShown,
	filterTapes,
	importButtonText,
	isListed,
	moveActive,
	type NoteLookup,
	selectedTapes,
	selectShown,
	type TapeRow,
	type TapeSelection,
	tapeLabel,
	toggleTape,
} from '#/src/tapedeck-tape-list'

/** Everything the tape picker needs from the plugin. */
export interface TapePickerInput {
	/** Shelf name, or "your enabled tape shelves", for the title. */
	readonly where: string
	/** Tapes on the shelf, newest first. */
	readonly files: ReadonlyArray<SessionFile>
	readonly cache: TapeInfoCache
	/** The vault's note for a session, if it has one. */
	readonly notes: NoteLookup
	readonly onImport: (files: ReadonlyArray<SessionFile>) => void
}

/** Rows drawn at once. Search still covers every tape; this only bounds the DOM. */
const renderLimit = 300

/** Tape headers read in parallel. */
const readConcurrency = 8

/** How often rows are redrawn while titles stream in. */
const redrawMs = 150

/**
 * Searchable checkbox list of every tape on a shelf. Rows appear at once with date and a project
 * guess; first prompts fill in as tape headers are read. Nothing is selected until you choose.
 */
export class TapePickerModal extends Modal {
	private readonly input: TapePickerInput
	private readonly filesByPath: ReadonlyMap<string, SessionFile>
	private readonly rowIndex: ReadonlyMap<string, number>
	private rows: Array<TapeRow>
	private shown: Array<TapeRow> = []
	private selection: TapeSelection = new Set()
	private query = ''
	private active = -1
	private loaded = 0
	private closed = false
	private redrawTimer: number | undefined
	private rowEls: Array<HTMLElement> = []

	private readonly searchEl = createEl('input', {
		type: 'search',
		cls: 'tapedeck-picker-search',
		attr: {
			'placeholder': 'Search project, first prompt, date, agent…',
			'aria-label': 'Search tapes',
		},
	})

	private readonly statusEl = createSpan({ cls: 'tapedeck-picker-status' })

	private readonly listEl = createDiv({
		cls: 'tapedeck-picker-list',
		attr: { 'role': 'listbox', 'aria-multiselectable': 'true', 'tabindex': '0' },
	})

	private selectAllButton: ButtonComponent | undefined
	private selectNoneButton: ButtonComponent | undefined
	private importButton: ButtonComponent | undefined

	constructor(app: App, input: TapePickerInput) {
		super(app)
		this.input = input
		this.filesByPath = new Map(input.files.map((file) => [file.path, file]))
		this.rowIndex = new Map(input.files.map((file, index) => [file.path, index]))

		this.rows = input.files.map((file) => {
			const info = input.cache.peek(file)

			if (info !== undefined) {
				this.loaded += 1
			}

			return input.cache.row(file, info, input.notes)
		})
	}

	override onOpen(): void {
		this.setTitle(`📼 Pick tapes · ${this.input.where}`)
		this.modalEl.addClass('tapedeck-picker')
		this.contentEl.append(this.searchEl)

		const toolbar = this.contentEl.createDiv({ cls: 'tapedeck-picker-toolbar' })

		this.selectAllButton = new ButtonComponent(toolbar).onClick(() => {
			this.setSelection(selectShown(this.selection, this.shown))
		})

		this.selectNoneButton = new ButtonComponent(toolbar).onClick(() => {
			this.setSelection(clearShown(this.selection, this.shown))
		})

		toolbar.append(this.statusEl)
		this.contentEl.append(this.listEl)

		const footer = this.contentEl.createDiv({ cls: 'tapedeck-picker-footer' })
		footer.createSpan({
			cls: 'tapedeck-picker-hint',
			text: '↑↓ move · Space toggle · Enter import · Esc close',
		})

		this.importButton = new ButtonComponent(footer).setCta().onClick(() => {
			this.submit()
		})

		this.searchEl.addEventListener('input', () => {
			this.query = this.searchEl.value
			this.active = this.shown.length === 0 ? -1 : 0
			this.render(true)
		})

		this.modalEl.addEventListener('keydown', (event) => {
			this.onKey(event)
		})

		this.listEl.addEventListener('keydown', (event) => {
			this.typeIntoSearch(event)
		})

		this.render(true)
		this.searchEl.focus()
		void this.loadTitles()
	}

	override onClose(): void {
		this.closed = true
		window.clearTimeout(this.redrawTimer)
		this.contentEl.empty()
	}

	/** Reads headers newest first, so the rows you see fill in first. */
	private async loadTitles(): Promise<void> {
		const pending = this.input.files.filter((file) => this.input.cache.peek(file) === undefined)

		await mapWithLimit(pending, readConcurrency, async (file) => {
			if (this.closed) {
				return
			}

			const info = await this.input.cache.read(file)
			this.fill(file, info)
		})
	}

	private fill(file: SessionFile, info: TapeInfo): void {
		const index = this.rowIndex.get(file.path)

		if (index !== undefined) {
			this.rows[index] = this.input.cache.row(file, info, this.input.notes)
		}

		this.loaded += 1

		this.redrawTimer ??= window.setTimeout(() => {
			this.redrawTimer = undefined
			this.render(false)
		}, redrawMs)
	}

	/** Redraws the filtered rows. `reset` scrolls to the top, as after a new search. */
	private render(reset: boolean): void {
		if (this.closed) {
			return
		}

		const scrollTop = this.listEl.scrollTop
		this.shown = filterTapes(this.rows, this.query)
		this.active = Math.min(this.active, this.shown.length - 1)
		this.listEl.empty()

		this.rowEls = this.shown.slice(0, renderLimit).map((row, index) => this.renderRow(row, index))

		this.renderListNote()
		this.listEl.scrollTop = reset ? 0 : scrollTop
		this.updateControls()
	}

	private renderRow(row: TapeRow, index: number): HTMLElement {
		const el = this.listEl.createDiv({ cls: 'tapedeck-picker-row', attr: { role: 'option' } })
		const box = el.createEl('input', { type: 'checkbox', attr: { tabindex: '-1' } })
		el.createSpan({ cls: 'tapedeck-picker-label', text: tapeLabel(row) })
		this.paintRow(el, box, row, index)

		el.addEventListener('click', (event) => {
			event.preventDefault()
			this.setActive(index)
			this.toggle(index)
			this.listEl.focus()
		})

		return el
	}

	private renderListNote(): void {
		if (this.shown.length === 0) {
			this.listEl.createDiv({
				cls: 'tapedeck-picker-note',
				text: this.rows.length === 0 ? 'No tapes on this shelf.' : 'No tapes match.',
			})

			return
		}

		if (this.shown.length > renderLimit) {
			this.listEl.createDiv({
				cls: 'tapedeck-picker-note',
				text: `Showing the newest ${renderLimit} of ${this.shown.length} matches; type to narrow the list.`,
			})
		}
	}

	private paintRow(el: HTMLElement, box: HTMLInputElement, row: TapeRow, index: number): void {
		const checked = this.selection.has(row.path)
		box.checked = checked
		el.toggleClass('is-active', index === this.active)
		el.toggleClass('is-checked', checked)
		el.setAttr('aria-selected', checked ? 'true' : 'false')
	}

	private repaint(index: number): void {
		const el = this.rowEls[index]
		const row = this.shown[index]
		const box = el?.querySelector('input')

		if (el !== undefined && row !== undefined && box !== null && box !== undefined) {
			this.paintRow(el, box, row, index)
		}
	}

	private updateControls(): void {
		const count = this.selection.size
		const shownSelected = this.shown.filter((row) => this.selection.has(row.path)).length
		const hidden = count - shownSelected

		const reading =
			this.loaded < this.rows.length ? ` · reading ${this.loaded}/${this.rows.length}` : ''

		const listed = this.rows.filter(isListed).length

		const hiddenNote = hidden > 0 ? ` (${hidden} hidden by search)` : ''

		this.statusEl.setText(
			`${count} selected${hiddenNote} · ${this.shown.length} of ${listed} shown${reading}`,
		)

		this.selectAllButton
			?.setButtonText(`Select all ${this.shown.length}`)
			.setDisabled(this.shown.length === 0 || allShownSelected(this.selection, this.shown))

		this.selectNoneButton?.setButtonText('Select none').setDisabled(shownSelected === 0)
		this.importButton?.setButtonText(importButtonText(count)).setDisabled(count === 0)
	}

	private setSelection(selection: TapeSelection): void {
		this.selection = selection
		this.rowEls.forEach((_el, index) => {
			this.repaint(index)
		})
		this.updateControls()
	}

	private toggle(index: number): void {
		const row = this.shown[index]

		if (row === undefined) {
			return
		}

		this.selection = toggleTape(this.selection, row.path)
		this.repaint(index)
		this.updateControls()
	}

	private setActive(index: number): void {
		const previous = this.active
		this.active = index
		this.repaint(previous)
		this.repaint(index)
		this.rowEls[index]?.scrollIntoView({ block: 'nearest' })
	}

	private onKey(event: KeyboardEvent): void {
		const fromList = event.target === this.listEl
		const handled = this.keyAction(event.key, fromList || event.target === this.searchEl, fromList)

		if (handled) {
			event.preventDefault()
		}
	}

	/**
	 * Arrows move the highlight from anywhere. Space toggles only from the list, so it still types in
	 * the search field. Enter imports from the list or the search field, not from a focused button.
	 */
	private keyAction(key: string, inField: boolean, fromList: boolean): boolean {
		if (key === 'ArrowDown' || key === 'ArrowUp') {
			this.move(key === 'ArrowDown' ? 1 : -1)

			return true
		}

		if (key === ' ' && fromList) {
			this.toggle(this.active)

			return true
		}

		if (key === 'Enter' && inField) {
			this.submit()

			return true
		}

		return false
	}

	/** Moves the highlight and hands focus to the list, so Space toggles instead of typing. */
	private move(delta: number): void {
		const visible = Math.min(this.shown.length, renderLimit)
		this.setActive(moveActive(this.active, delta, visible))

		if (visible > 0) {
			this.listEl.focus()
		}
	}

	/** Typing while the list has focus goes back to the search field. */
	private typeIntoSearch(event: KeyboardEvent): void {
		const printable = event.key.length === 1 && event.key !== ' '
		const editing = event.key === 'Backspace'

		if ((printable || editing) && !event.ctrlKey && !event.metaKey && !event.altKey) {
			this.searchEl.focus()
		}
	}

	private submit(): void {
		const chosen = selectedTapes(this.rows, this.selection).flatMap((row) => {
			const file = this.filesByPath.get(row.path)

			return file === undefined ? [] : [file]
		})

		if (chosen.length === 0) {
			new Notice('📼 Tapedeck: tick some tapes first (Space or click).')

			return
		}

		this.close()
		this.input.onImport(chosen)
	}
}
