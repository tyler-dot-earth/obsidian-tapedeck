import { type App, FuzzySuggestModal, Modal, Setting } from 'obsidian'

import type { SessionFile } from '#/src/dailies-session-files'
import { transcriptSources } from '#/src/dailies-sources'
import type { TranscriptSource } from '#/src/dailies-transcript'

/** One row in the recent-sessions picker. `undefined` file means "import every listed session". */
export interface SessionChoice {
	readonly label: string
	readonly file: SessionFile | undefined
}

/** Picks a session from the recent list. */
export class SessionSuggestModal extends FuzzySuggestModal<SessionChoice> {
	private readonly choices: ReadonlyArray<SessionChoice>
	private readonly onChoose: (choice: SessionChoice) => void

	constructor(
		app: App,
		choices: ReadonlyArray<SessionChoice>,
		onChoose: (choice: SessionChoice) => void,
	) {
		super(app)
		this.choices = choices
		this.onChoose = onChoose
		this.setPlaceholder('🎞️ Pick a take to import')
	}

	override getItems(): Array<SessionChoice> {
		return [...this.choices]
	}

	override getItemText(item: SessionChoice): string {
		return item.label
	}

	override onChooseItem(item: SessionChoice): void {
		this.onChoose(item)
	}
}

/** Picks one source, or every source. */
export class SourceSuggestModal extends FuzzySuggestModal<TranscriptSource | 'all'> {
	private readonly onChoose: (source: TranscriptSource | 'all') => void

	constructor(app: App, onChoose: (source: TranscriptSource | 'all') => void) {
		super(app)
		this.onChoose = onChoose
		this.setPlaceholder('📽️ Which reel?')
	}

	override getItems(): Array<TranscriptSource | 'all'> {
		return ['all', ...transcriptSources]
	}

	override getItemText(item: TranscriptSource | 'all'): string {
		return item === 'all' ? '🎞️ All sources' : `${item.emoji} ${item.label}`
	}

	override onChooseItem(item: TranscriptSource | 'all'): void {
		this.onChoose(item)
	}
}

/** What the import-file modal hands back. */
export type FileChoice =
	| { readonly kind: 'path'; readonly path: string }
	| { readonly kind: 'picked'; readonly name: string; readonly text: string }

/** Path field plus a file picker for one session file. */
export class ImportFileModal extends Modal {
	private readonly onChoose: (choice: FileChoice) => void
	private path = ''

	constructor(app: App, onChoose: (choice: FileChoice) => void) {
		super(app)
		this.onChoose = onChoose
	}

	override onOpen(): void {
		this.setTitle('🎬 Import a session file')

		new Setting(this.contentEl)
			.setClass('dailies-import-path')
			.setName('Path')
			.setDesc('Full path to a .jsonl session file. ~ works.')
			.addText((text) =>
				text.setPlaceholder('~/.claude/projects/…/session.jsonl').onChange((value) => {
					this.path = value.trim()
				}),
			)

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Choose file…').onClick(() => {
					this.pickFile()
				}),
			)
			.addButton((button) =>
				button
					.setButtonText('Import')
					.setCta()
					.onClick(() => {
						this.submitPath()
					}),
			)
	}

	private submitPath(): void {
		if (this.path === '') {
			return
		}

		this.close()
		this.onChoose({ kind: 'path', path: this.path })
	}

	private pickFile(): void {
		const input = this.contentEl.createEl('input', { type: 'file', attr: { accept: '.jsonl' } })
		input.hide()

		input.addEventListener('change', () => {
			const file = input.files?.item(0)

			if (file === null || file === undefined) {
				return
			}

			void this.readPicked(file)
		})

		input.click()
	}

	private async readPicked(file: File): Promise<void> {
		const text = await file.text()
		this.close()
		this.onChoose({ kind: 'picked', name: file.name, text })
	}

	override onClose(): void {
		this.contentEl.empty()
	}
}
