import { type App, Modal, Setting } from 'obsidian'

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
		this.setTitle('⏏️ Load a session tape')

		new Setting(this.contentEl)
			.setClass('tapedeck-import-path')
			.setName('Path')
			.setDesc('Full path to a .jsonl session file (~ works).')
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
