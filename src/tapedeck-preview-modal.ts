import { type App, ButtonComponent, Component, MarkdownRenderer, Modal } from 'obsidian'

import { tapedeckErrorMessage } from '#/src/tapedeck-errors'
import { confirmAbove, type TapePreview, turnCount } from '#/src/tapedeck-preview'
import {
	importButtonText,
	isInVault,
	projectText,
	type TapeRow,
	tapeWhen,
} from '#/src/tapedeck-tape-list'

/** What the preview needs: the row, how to load it, and what its buttons do. */
export interface TapePreviewInput {
	readonly row: TapeRow
	readonly load: () => Promise<TapePreview>
	readonly onImport: () => void
	readonly onOpenNote: (() => void) | undefined
}

/** 📼 Read-only look at a tape before importing it. It never imports on its own. */
export class TapePreviewModal extends Modal {
	private readonly input: TapePreviewInput
	private readonly markdown = new Component()

	constructor(app: App, input: TapePreviewInput) {
		super(app)
		this.input = input
	}

	override onOpen(): void {
		const { row } = this.input
		this.modalEl.addClass('tapedeck-preview')
		this.setTitle(`${row.emoji} ${row.title ?? 'Tape preview'}`)
		const meta = this.contentEl.createDiv({ cls: 'tapedeck-preview-meta' })
		const facts = [row.agent, projectText(row) ?? 'no project', tapeWhen(row)]
		meta.setText(facts.join(' · '))
		const body = this.contentEl.createDiv({ cls: 'tapedeck-preview-body', text: 'Reading tape…' })
		this.buildButtons()
		this.markdown.load()
		void this.fill(meta, body, facts)
	}

	override onClose(): void {
		this.markdown.unload()
		this.contentEl.empty()
	}

	private buildButtons(): void {
		const { row, onImport, onOpenNote } = this.input
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' })

		if (onOpenNote !== undefined) {
			new ButtonComponent(buttons).setButtonText('Open note').onClick(() => {
				this.close()
				onOpenNote()
			})
		}

		new ButtonComponent(buttons)
			.setButtonText(isInVault(row) ? 'Re-import' : 'Import')
			.setCta()
			.onClick(() => {
				this.close()
				onImport()
			})

		new ButtonComponent(buttons).setButtonText('Close').onClick(() => {
			this.close()
		})
	}

	private async fill(
		meta: HTMLElement,
		body: HTMLElement,
		facts: ReadonlyArray<string>,
	): Promise<void> {
		try {
			const preview = await this.input.load()
			this.setTitle(`${this.input.row.emoji} ${preview.title}`)
			meta.setText([...facts, turnCount(preview)].join(' · '))
			body.empty()
			await MarkdownRenderer.render(this.app, preview.markdown, body, '', this.markdown)
		} catch (error) {
			body.setText(`Couldn't read this tape: ${tapedeckErrorMessage(error)}`)
			body.addClass('mod-warning')
		}
	}
}

/** Asks before importing a big selection. */
export class ConfirmImportModal extends Modal {
	private readonly count: number
	private readonly onConfirm: () => void

	constructor(app: App, count: number, onConfirm: () => void) {
		super(app)
		this.count = count
		this.onConfirm = onConfirm
	}

	override onOpen(): void {
		this.setTitle(`📼 ${importButtonText(this.count)}?`)
		this.contentEl.createEl('p', { text: `That is more than ${confirmAbove} tapes at once.` })
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' })

		new ButtonComponent(buttons)
			.setButtonText(importButtonText(this.count))
			.setCta()
			.onClick(() => {
				this.close()
				this.onConfirm()
			})

		new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => {
			this.close()
		})
	}

	override onClose(): void {
		this.contentEl.empty()
	}
}
