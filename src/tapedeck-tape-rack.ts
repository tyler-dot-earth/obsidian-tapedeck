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
	WorkspaceMobileDrawer,
	WorkspaceSidedock,
} from 'obsidian'

import { mapWithLimit } from '#/src/tapedeck-concurrency'
import { needsConfirm, type TapePreview } from '#/src/tapedeck-preview'
import { ConfirmImportModal, TapePreviewModal } from '#/src/tapedeck-preview-modal'
import {
	allFolded,
	groupTapes,
	outcomeBadges,
	RenderGate,
	type RowOutcome,
	rowOutcome,
	type TapeImportResult,
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
import type { TapeInfoCache } from '#/src/tapedeck-tape-info'
import {
	importButtonText,
	isInVault,
	isListed,
	projectText,
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
	/** Imports the tapes and reports how each went, with a notice. */
	readonly importTapes: (
		files: ReadonlyArray<SessionFile>,
	) => Promise<ReadonlyArray<TapeImportResult>>
	readonly openNote: (path: string) => Promise<void>
	/** Reads a tape for the preview, without importing it. */
	readonly preview: (file: SessionFile) => Promise<TapePreview>
}

/** Lines drawn at first, and added per "Show more". The search always covers every tape. */
const pageSize = 200

/** Tape headers read in parallel. */
const readConcurrency = 8

/** How often rows are redrawn while first prompts stream in. */
const redrawMs = 150

/** How long a just-imported row is highlighted. */
const flashMs = 1500

/** Re-lists the shelves this often while the rack is on screen. Listing never imports. */
const refreshMs = 5 * 60_000

/** Coming back to the rack re-lists the shelves if the last listing is older than this. */
const staleMs = 30_000

/** Longest wait for an idle moment before the first listing starts anyway. */
const idleTimeoutMs = 3000

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
	/** Set once the workspace layout is ready; nothing is listed before that. */
	private layoutReady = false
	/** Set when the first listing has been scheduled, which waits until the rack is on screen. */
	private started = false
	private redrawTimer: number | undefined
	private notesTimer: number | undefined
	private groupDropdown: DropdownComponent | undefined
	private hideToggle: ToggleComponent | undefined
	private foldButton: ExtraButtonComponent | undefined
	private groups: ReadonlyArray<RackGroup> = []
	private importButton: ButtonComponent | undefined
	private clearButton: ButtonComponent | undefined
	private readonly gate = new RenderGate()
	/** Rows imported (or failed) from the rack since the last refresh, kept visible. */
	private kept: ReadonlySet<string> = new Set()
	private outcomes = new Map<string, RowOutcome>()
	private readonly flashUntil = new Map<string, number>()
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
		this.statusEl.setText('Waiting to list tapes…')
		this.watchVault()
		this.watchPointer()
		this.watchVisibility()

		this.registerInterval(
			window.setInterval(() => {
				if (this.started && this.isOnScreen()) {
					void this.refresh()
				}
			}, refreshMs),
		)

		this.app.workspace.onLayoutReady(() => {
			this.layoutReady = true
			this.startWhenShown()
		})

		await Promise.resolve()
	}

	override onResize(): void {
		this.startWhenShown()
	}

	/**
	 * Whether the rack can be seen: its tab is the one showing and its sidebar is not collapsed. A
	 * restored rack in a hidden tab or a collapsed sidebar lists nothing until it is shown.
	 */
	private isOnScreen(): boolean {
		const root = this.leaf.getRoot()

		const collapsed =
			(root instanceof WorkspaceSidedock || root instanceof WorkspaceMobileDrawer) && root.collapsed

		return !collapsed && this.containerEl.isShown()
	}

	/**
	 * Lists the shelves the first time the rack is on screen after the layout is ready, in an idle
	 * moment, so restoring the workspace never waits on reading tapes.
	 */
	private startWhenShown(): void {
		if (this.started || !this.layoutReady || !this.isOnScreen()) {
			return
		}

		this.started = true

		window.requestIdleCallback(
			() => {
				void this.refresh()
			},
			{ timeout: idleTimeoutMs },
		)
	}

	private watchVisibility(): void {
		const check = (): void => {
			this.startWhenShown()
		}

		this.registerEvent(this.app.workspace.on('layout-change', check))
		this.registerEvent(this.app.workspace.on('resize', check))
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
				this.started = true
				void this.refresh()
			})

		this.buildFilters(header)
		header.append(this.statusEl, this.selectionEl)

		this.importButton = new ButtonComponent(this.selectionEl).setCta().onClick(() => {
			this.importSelected()
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
			this.forgetOutcomes()
			this.limit = pageSize
			this.render()
			this.app.workspace.requestSaveLayout()
		})

		hide.createSpan({ text: 'Hide imported' })
		setTooltip(hide, 'Hide tapes that already have a note')
	}

	/** Holds redraws while the pointer is down on the list, so clicks always land. */
	private watchPointer(): void {
		this.registerDomEvent(this.listEl, 'pointerdown', () => {
			this.gate.hold()
		})

		const release = (): void => {
			if (this.gate.release()) {
				window.setTimeout(() => {
					this.render()
				}, 0)
			}
		}

		this.registerDomEvent(window, 'pointerup', release)
		this.registerDomEvent(window, 'pointercancel', release)
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
				if (leaf !== this.leaf) {
					return
				}

				if (!this.started) {
					this.startWhenShown()
				} else if (Date.now() - this.listedAt > staleMs) {
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
		this.forgetOutcomes()
		this.loaded = 0
		this.rows = this.files.map((file) => this.rowFor(file))
		const known = new Set(this.files.map((file) => file.path))
		this.selection = new Set([...this.selection].filter((path) => known.has(path)))
		this.render()
		await this.loadTitles(this.generation)
	}

	/** Drops finished import marks, so imported rows follow the filters again. */
	private forgetOutcomes(): void {
		this.outcomes = new Map(
			[...this.outcomes].filter(([, outcome]) => outcome.kind === 'importing'),
		)
		this.kept = new Set(this.outcomes.keys())
	}

	private rowFor(file: SessionFile): TapeRow {
		const info = this.host.cache.peek(file)

		if (info !== undefined) {
			this.loaded += 1
		}

		return this.host.cache.row(file, info, this.notes)
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
				this.rows[index] = this.host.cache.row(file, info, this.notes)
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

	/** Redraws now, or once the pointer is released. */
	private render(): void {
		if (this.gate.request()) {
			this.draw()
		}
	}

	private draw(): void {
		const visible = rackTapes(this.rows, this.query, this.hideInVault, this.kept)
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
		const outcome = this.outcomes.get(row.path)
		el.toggleClass('is-checked', this.selection.has(row.path))
		el.toggleClass('is-failed', outcome?.kind === 'failed')
		el.toggleClass('is-flash', (this.flashUntil.get(row.path) ?? 0) > Date.now())

		el.setAttr('aria-label', rowClickAction(row) === 'open' ? 'Open the note' : 'Preview this tape')

		const box = el.createEl('input', { type: 'checkbox', cls: 'tapedeck-rack-check' })
		box.checked = this.selection.has(row.path)

		box.addEventListener('click', (event) => {
			event.stopPropagation()
			this.selection = toggleTape(this.selection, row.path)
			this.render()
		})

		this.renderRowButton(this.renderRowBody(el, row), row)

		el.addEventListener('click', () => {
			void this.clickRow(row)
		})
	}

	/** Draws the meta line and title; returns the meta line, which also holds the row button. */
	private renderRowBody(el: HTMLElement, row: TapeRow): HTMLElement {
		const body = el.createDiv({ cls: 'tapedeck-rack-body' })
		const meta = body.createDiv({ cls: 'tapedeck-rack-meta' })
		meta.createSpan({ text: row.emoji, attr: { 'aria-label': row.agent } })
		meta.createSpan({ cls: 'tapedeck-rack-when', text: tapeWhen(row) })

		const project = this.groupBy === 'project' ? row.worktree : projectText(row)

		if (project !== undefined) {
			meta.createSpan({ cls: 'tapedeck-rack-project', text: project })
		}

		this.renderBadge(meta, row)
		body.createDiv({ cls: 'tapedeck-rack-title', text: row.title ?? '…' })

		return meta
	}

	private renderBadge(meta: HTMLElement, row: TapeRow): void {
		const outcome = this.outcomes.get(row.path)

		if (outcome !== undefined) {
			this.renderOutcome(meta, outcome)

			return
		}

		const badge = stateBadges[row.state]

		if (badge !== '') {
			meta.createSpan({
				cls: `tapedeck-rack-badge is-${row.state}`,
				text: badge,
				attr: { 'aria-label': stateTooltips[row.state] },
			})
		}
	}

	private renderOutcome(meta: HTMLElement, outcome: RowOutcome): void {
		const badge = meta.createSpan({
			cls: `tapedeck-rack-badge is-${outcome.kind}`,
			text: outcomeBadges[outcome.kind],
		})

		if (outcome.kind === 'failed') {
			badge.setAttr('aria-label', outcome.message)

			return
		}

		if (outcome.kind === 'imported') {
			badge.addClass('is-link')
			badge.setAttr('aria-label', 'Open the note')

			badge.addEventListener('click', (event) => {
				event.stopPropagation()
				void this.host.openNote(outcome.notePath)
			})
		}
	}

	/**
	 * The import button sits in the meta line. With a mouse it is lifted out and overlaid on the
	 * row's right edge on hover, so it takes no width; on touch screens it stays inline.
	 */
	private renderRowButton(meta: HTMLElement, row: TapeRow): void {
		const reimport = isInVault(row)

		new ExtraButtonComponent(meta)
			.setIcon(reimport ? 'rotate-ccw' : 'download')
			.setTooltip(reimport ? 'Re-import this tape' : 'Import this tape')
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
		if (rowClickAction(row) === 'open' && row.notePath !== undefined) {
			await this.host.openNote(row.notePath)

			return
		}

		this.openPreview(row)
	}

	private openPreview(row: TapeRow): void {
		const file = this.files.find((candidate) => candidate.path === row.path)

		if (file === undefined) {
			return
		}

		const notePath = row.notePath

		new TapePreviewModal(this.app, {
			row,
			load: async (): Promise<TapePreview> => this.host.preview(file),
			onImport: (): void => {
				void this.importRows([row])
			},
			onOpenNote:
				notePath === undefined
					? undefined
					: (): void => {
							void this.host.openNote(notePath)
						},
		}).open()
	}

	private importSelected(): void {
		const chosen = this.rows.filter((row) => this.selection.has(row.path))

		const run = (): void => {
			this.selection = new Set()
			this.render()
			void this.importRows(chosen)
		}

		if (needsConfirm(chosen.length)) {
			new ConfirmImportModal(this.app, chosen.length, run).open()

			return
		}

		run()
	}

	/** Imports rows, keeping them in place with a badge for how each went. */
	private async importRows(rows: ReadonlyArray<TapeRow>): Promise<void> {
		const byPath = new Map(this.files.map((file) => [file.path, file]))
		const files = rows.flatMap((row) => byPath.get(row.path) ?? [])
		this.kept = new Set([...this.kept, ...files.map((file) => file.path)])

		for (const file of files) {
			this.outcomes.set(file.path, { kind: 'importing' })
		}

		this.render()
		const results = await this.host.importTapes(files)
		const flashUntil = Date.now() + flashMs

		for (const result of results) {
			this.outcomes.set(result.path, rowOutcome(result))
			this.flashUntil.set(result.path, flashUntil)
		}

		this.updateStates()
	}
}
