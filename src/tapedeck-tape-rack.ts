import { Option, Schema } from 'effect'
import {
	ButtonComponent,
	DropdownComponent,
	ExtraButtonComponent,
	ItemView,
	setIcon,
	setTooltip,
	ToggleComponent,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian'

import { mapWithLimit } from '#/src/tapedeck-concurrency'
import {
	allFolded,
	groupTapes,
	type RackGroup,
	type RackGrouping,
	defaultRackGrouping,
	rackGroupingLabels,
	type RackItem,
	rackItems,
	rackSummary,
	rackTapes,
	rowClickAction,
	stateBadges,
	stateTooltips,
	toggleAllFolds,
} from '#/src/tapedeck-rack-list'
import type { SessionFile } from '#/src/tapedeck-session-files'
import { type TapeInfoCache, tapeRow } from '#/src/tapedeck-tape-info'
import {
	importButtonText,
	isInVault,
	isListed,
	type NoteLookup,
	type TapeRow,
	type TapeSelection,
	tapeWhen,
	toggleTape,
} from '#/src/tapedeck-tape-list'

/** View type id for the tape rack. */
export const tapeRackViewType = 'tapedeck-tape-rack'

/** What the rack needs from the plugin. */
export interface TapeRackHost {
	/** Tapes on the enabled shelves, newest first. */
	readonly listTapes: () => Promise<ReadonlyArray<SessionFile>>
	readonly cache: TapeInfoCache
	/** A fresh lookup of transcript notes in the vault. */
	readonly notes: () => NoteLookup
	/** Imports the tapes; one tape opens its note when done. */
	readonly importTapes: (files: ReadonlyArray<SessionFile>) => Promise<void>
	readonly openNote: (path: string) => Promise<void>
}

/** Lines drawn at first, and added per "Show more". The search always covers every tape. */
const pageSize = 200

/** Tape headers read in parallel. */
const readConcurrency = 8

/** How often rows are redrawn while first prompts stream in. */
const redrawMs = 150

/** Re-lists the shelves this often while the rack is on screen. Listing never imports. */
const refreshMs = 5 * 60_000

/** Coming back to the rack re-lists the shelves if the last listing is older than this. */
const staleMs = 30_000

/** Wait after vault changes before recomputing states, so a batch import redraws once. */
const notesSettleMs = 400

const RackViewState = Schema.Struct({
	/** Saved as `grouping`; layouts from before "By project" became the default used `groupBy`. */
	grouping: Schema.optionalKey(Schema.Literals(['none', 'project', 'shelf'])),
	hideInVault: Schema.optionalKey(Schema.Boolean),
})

/** Rack options kept in the workspace layout. */
type RackViewState = Schema.Schema.Type<typeof RackViewState>

/**
 * 📼 Sidebar list of every tape on the enabled shelves. Shows what is new, in the vault, or changed
 * since import; it only imports what you click or tick.
 */
export class TapeRackView extends ItemView {
	private readonly host: TapeRackHost
	private files: ReadonlyArray<SessionFile> = []
	private rows: Array<TapeRow> = []
	private notes: NoteLookup = () => undefined
	private selection: TapeSelection = new Set()
	private collapsed: ReadonlySet<string> = new Set()
	private query = ''
	private groupBy: RackGrouping = defaultRackGrouping
	private hideInVault = false
	private limit = pageSize
	private loaded = 0
	private generation = 0
	private listing = false
	private listedAt = 0
	private redrawTimer: number | undefined
	private notesTimer: number | undefined
	private groupDropdown: DropdownComponent | undefined
	private hideToggle: ToggleComponent | undefined
	private foldButton: ExtraButtonComponent | undefined
	private groups: ReadonlyArray<RackGroup> = []
	private importButton: ButtonComponent | undefined
	private clearButton: ButtonComponent | undefined
	private readonly statusEl = createDiv({ cls: 'tapedeck-rack-status' })
	private readonly selectionEl = createDiv({ cls: 'tapedeck-rack-selection' })
	private readonly listEl = createDiv({ cls: 'tapedeck-rack-list' })

	constructor(leaf: WorkspaceLeaf, host: TapeRackHost) {
		super(leaf)
		this.host = host
	}

	override getViewType(): string {
		return tapeRackViewType
	}

	override getDisplayText(): string {
		return 'Tape rack'
	}

	override getIcon(): string {
		return 'cassette-tape'
	}

	override getState(): RackViewState {
		return { grouping: this.groupBy, hideInVault: this.hideInVault }
	}

	override async setState(state: RackViewState, result: ViewStateResult): Promise<void> {
		// The layout file is user data, so check it even though the signature names the shape.
		const saved = Option.getOrUndefined(Schema.decodeUnknownOption(RackViewState)(state))
		this.groupBy = saved?.grouping ?? this.groupBy
		this.hideInVault = saved?.hideInVault ?? this.hideInVault
		this.groupDropdown?.setValue(this.groupBy)
		this.hideToggle?.setValue(this.hideInVault)
		this.render()
		await super.setState(state, result)
	}

	override async onOpen(): Promise<void> {
		this.contentEl.empty()
		this.contentEl.addClass('tapedeck-rack')
		this.buildHeader()
		this.contentEl.append(this.listEl)
		this.watchVault()

		this.registerInterval(
			window.setInterval(() => {
				if (this.containerEl.isShown()) {
					void this.refresh()
				}
			}, refreshMs),
		)

		await this.refresh()
	}

	override async onClose(): Promise<void> {
		this.generation += 1
		window.clearTimeout(this.redrawTimer)
		window.clearTimeout(this.notesTimer)
		this.contentEl.empty()
		await Promise.resolve()
	}

	private buildHeader(): void {
		const header = this.contentEl.createDiv({ cls: 'tapedeck-rack-header' })
		const top = header.createDiv({ cls: 'tapedeck-rack-row-controls' })

		const search = top.createEl('input', {
			type: 'search',
			cls: 'tapedeck-rack-search',
			attr: { 'placeholder': 'Search tapes…', 'aria-label': 'Search tapes' },
		})

		search.addEventListener('input', () => {
			this.query = search.value
			this.limit = pageSize
			this.render()
		})

		this.foldButton = new ExtraButtonComponent(top).onClick(() => {
			this.collapsed = toggleAllFolds(this.groups, this.collapsed)
			this.render()
		})

		new ExtraButtonComponent(top)
			.setIcon('refresh-cw')
			.setTooltip('Refresh the tape list')
			.onClick(() => {
				void this.refresh()
			})

		this.buildFilters(header)
		header.append(this.statusEl, this.selectionEl)

		this.importButton = new ButtonComponent(this.selectionEl).setCta().onClick(() => {
			void this.importSelected()
		})

		this.clearButton = new ButtonComponent(this.selectionEl).setButtonText('Clear').onClick(() => {
			this.selection = new Set()
			this.render()
		})
	}

	private buildFilters(header: HTMLElement): void {
		const filters = header.createDiv({ cls: 'tapedeck-rack-row-controls' })

		this.groupDropdown = new DropdownComponent(filters)
			.addOptions(rackGroupingLabels)
			.setValue(this.groupBy)
			.onChange((value) => {
				this.groupBy = value === 'project' || value === 'shelf' ? value : 'none'
				this.collapsed = new Set()
				this.limit = pageSize
				this.render()
				this.app.workspace.requestSaveLayout()
			})

		const hide = filters.createEl('label', { cls: 'tapedeck-rack-hide' })

		this.hideToggle = new ToggleComponent(hide).setValue(this.hideInVault).onChange((value) => {
			this.hideInVault = value
			this.limit = pageSize
			this.render()
			this.app.workspace.requestSaveLayout()
		})

		hide.createSpan({ text: 'Hide imported' })
		setTooltip(hide, 'Hide tapes that already have a note')
	}

	/** Badges follow the vault, and returning to the rack re-lists stale shelves. */
	private watchVault(): void {
		const settle = (): void => {
			window.clearTimeout(this.notesTimer)
			this.notesTimer = window.setTimeout(() => {
				this.updateStates()
			}, notesSettleMs)
		}

		this.registerEvent(this.app.metadataCache.on('changed', settle))
		this.registerEvent(this.app.vault.on('delete', settle))
		this.registerEvent(this.app.vault.on('rename', settle))

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf === this.leaf && Date.now() - this.listedAt > staleMs) {
					void this.refresh()
				}
			}),
		)
	}

	/** Re-lists the shelves and re-reads tapes whose files changed. Never imports anything. */
	private async refresh(): Promise<void> {
		if (this.listing) {
			return
		}

		this.listing = true
		this.statusEl.setText('Listing tapes…')

		try {
			this.files = await this.host.listTapes()
			this.listedAt = Date.now()
		} finally {
			this.listing = false
		}

		this.generation += 1
		this.notes = this.host.notes()
		this.loaded = 0
		this.rows = this.files.map((file) => this.rowFor(file))
		const known = new Set(this.files.map((file) => file.path))
		this.selection = new Set([...this.selection].filter((path) => known.has(path)))
		this.render()
		await this.loadTitles(this.generation)
	}

	private rowFor(file: SessionFile): TapeRow {
		const info = this.host.cache.peek(file)

		if (info !== undefined) {
			this.loaded += 1
		}

		return tapeRow(file, info, this.notes)
	}

	private updateStates(): void {
		this.notes = this.host.notes()
		this.loaded = 0
		this.rows = this.files.map((file) => this.rowFor(file))
		this.render()
	}

	/** Reads first prompts newest first; a refresh starts a new generation and stops this one. */
	private async loadTitles(generation: number): Promise<void> {
		const pending = this.files
			.map((file, index) => ({ file, index }))
			.filter(({ file }) => this.host.cache.peek(file) === undefined)

		await mapWithLimit(pending, readConcurrency, async ({ file, index }) => {
			if (generation !== this.generation) {
				return
			}

			const info = await this.host.cache.read(file)

			if (generation === this.generation) {
				this.rows[index] = tapeRow(file, info, this.notes)
				this.loaded += 1
				this.scheduleRender()
			}
		})
	}

	private scheduleRender(): void {
		this.redrawTimer ??= window.setTimeout(() => {
			this.redrawTimer = undefined
			this.render()
		}, redrawMs)
	}

	private render(): void {
		const visible = rackTapes(this.rows, this.query, this.hideInVault)
		const groups = groupTapes(visible, this.groupBy)
		this.groups = groups
		const items = rackItems(groups, this.groupBy, this.collapsed)
		const scrollTop = this.listEl.scrollTop
		this.listEl.empty()

		for (const item of items.slice(0, this.limit)) {
			this.renderItem(item)
		}

		this.renderListEnd(items.length, visible.length)
		this.listEl.scrollTop = scrollTop
		this.updateStatus(visible)
		this.updateFoldButton()
	}

	/** Shown only while grouping; folds every group, or unfolds them when all are folded. */
	private updateFoldButton(): void {
		const button = this.foldButton

		if (button === undefined) {
			return
		}

		const folded = allFolded(this.groups, this.collapsed)
		button.extraSettingsEl.toggleClass('is-hidden', this.groupBy === 'none')
		button.setIcon(folded ? 'chevrons-up-down' : 'chevrons-down-up')
		button.setTooltip(folded ? 'Expand all groups' : 'Collapse all groups')
	}

	private renderItem(item: RackItem): void {
		if (item.kind === 'group') {
			this.renderGroup(item.group, item.collapsed)

			return
		}

		this.renderRow(item.row)
	}

	private renderGroup(group: RackGroup, collapsed: boolean): void {
		const el = this.listEl.createDiv({ cls: 'tapedeck-rack-group' })
		el.toggleClass('is-collapsed', collapsed)
		setIcon(el.createSpan({ cls: 'tapedeck-rack-group-icon' }), 'chevron-down')
		el.createSpan({ cls: 'tapedeck-rack-group-label', text: group.label })
		el.createSpan({ cls: 'tapedeck-rack-group-count', text: String(group.rows.length) })

		el.addEventListener('click', () => {
			this.collapsed = toggleTape(this.collapsed, group.key)
			this.render()
		})
	}

	private renderRow(row: TapeRow): void {
		const el = this.listEl.createDiv({ cls: `tapedeck-rack-tape is-${row.state}` })
		el.toggleClass('is-checked', this.selection.has(row.path))

		el.setAttr(
			'aria-label',
			rowClickAction(row) === 'open' ? 'Click to open the note' : 'Click to import',
		)

		const box = el.createEl('input', { type: 'checkbox', cls: 'tapedeck-rack-check' })
		box.checked = this.selection.has(row.path)

		box.addEventListener('click', (event) => {
			event.stopPropagation()
			this.selection = toggleTape(this.selection, row.path)
			this.render()
		})

		this.renderRowBody(el, row)
		this.renderRowButton(el, row)

		el.addEventListener('click', () => {
			void this.clickRow(row)
		})
	}

	private renderRowBody(el: HTMLElement, row: TapeRow): void {
		const body = el.createDiv({ cls: 'tapedeck-rack-body' })
		const meta = body.createDiv({ cls: 'tapedeck-rack-meta' })
		meta.createSpan({ text: row.emoji, attr: { 'aria-label': row.agent } })
		meta.createSpan({ cls: 'tapedeck-rack-when', text: tapeWhen(row) })

		if (row.project !== undefined && this.groupBy !== 'project') {
			meta.createSpan({ cls: 'tapedeck-rack-project', text: row.project })
		}

		const badge = stateBadges[row.state]

		if (badge !== '') {
			meta.createSpan({
				cls: `tapedeck-rack-badge is-${row.state}`,
				text: badge,
				attr: { 'aria-label': stateTooltips[row.state] },
			})
		}

		body.createDiv({ cls: 'tapedeck-rack-title', text: row.title ?? '…' })
	}

	private renderRowButton(el: HTMLElement, row: TapeRow): void {
		const reimport = isInVault(row)

		new ExtraButtonComponent(el)
			.setIcon(reimport ? 'rotate-ccw' : 'download')
			.setTooltip(reimport ? 'Re-import' : 'Import')
			.onClick(() => {
				void this.importRows([row])
			})
			.extraSettingsEl.addEventListener('click', (event) => {
				event.stopPropagation()
			})
	}

	private renderListEnd(itemCount: number, tapeCount: number): void {
		if (tapeCount === 0) {
			this.listEl.createDiv({ cls: 'tapedeck-rack-note', text: this.emptyText() })

			return
		}

		if (itemCount > this.limit) {
			new ButtonComponent(this.listEl.createDiv({ cls: 'tapedeck-rack-more' }))
				.setButtonText(`Show more (${itemCount - this.limit} left)`)
				.onClick(() => {
					this.limit += pageSize
					this.render()
				})
		}
	}

	private emptyText(): string {
		if (this.files.length === 0) {
			return 'No tapes on your enabled shelves.'
		}

		return this.query === '' ? 'Every tape is already in the vault.' : 'No tapes match.'
	}

	private updateStatus(visible: ReadonlyArray<TapeRow>): void {
		const reading =
			this.loaded < this.rows.length ? ` · reading ${this.loaded}/${this.rows.length}` : ''

		const unlisted = this.rows.filter((row) => !isListed(row)).length
		this.statusEl.setText(`${rackSummary(visible, unlisted)}${reading}`)
		const count = this.selection.size
		this.selectionEl.toggleClass('is-hidden', count === 0)
		this.importButton?.setButtonText(importButtonText(count))
		this.clearButton?.setDisabled(count === 0)
	}

	private async clickRow(row: TapeRow): Promise<void> {
		await (rowClickAction(row) === 'open' && row.notePath !== undefined
			? this.host.openNote(row.notePath)
			: this.importRows([row]))
	}

	private async importSelected(): Promise<void> {
		const chosen = this.rows.filter((row) => this.selection.has(row.path))
		this.selection = new Set()
		this.render()
		await this.importRows(chosen)
	}

	private async importRows(rows: ReadonlyArray<TapeRow>): Promise<void> {
		const byPath = new Map(this.files.map((file) => [file.path, file]))
		const files = rows.flatMap((row) => byPath.get(row.path) ?? [])
		await this.host.importTapes(files)
		this.updateStates()
	}
}
