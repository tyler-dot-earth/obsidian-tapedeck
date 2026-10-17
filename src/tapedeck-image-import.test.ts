import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, assert, beforeAll, describe, it } from '@effect/vitest'
import { Result } from 'effect'

import { type ImageImportOptions, resolveImages } from '#/src/tapedeck-image-import'
import { type RenderOptions, renderTranscriptNote } from '#/src/tapedeck-render'
import { claudeCodeSource } from '#/src/tapedeck-source-claude-code'
import { codexSource } from '#/src/tapedeck-source-codex'
import type { ImageSource, Transcript } from '#/src/tapedeck-transcript'

const parsed = (name: string): Transcript =>
	Result.getOrThrow(
		(name === 'codex' ? codexSource : claudeCodeSource).parse(
			readFileSync(`fixtures/images/${name}.jsonl`, 'utf8'),
		),
	)

/** Images of a transcript in note order, user images and tool images alike. */
const imagesOf = (transcript: Transcript): Array<ImageSource> =>
	transcript.turns.flatMap((turn) =>
		turn.blocks.flatMap((block) => {
			if (block.kind === 'image') {
				return [block.source]
			}

			return block.kind === 'tool' ? [...block.images] : []
		}),
	)

/** In-memory attachment folder: the names saved, and options that save into it. */
interface FakeVault {
	readonly saved: Array<string>
	readonly options: (extra: Partial<ImageImportOptions>) => ImageImportOptions
}

/** In-memory attachment folder: records each save and embeds by name. */
const fakeVault = (): FakeVault => {
	const saved: Array<string> = []

	return {
		saved,
		options: (extra) => ({
			enabled: true,
			maxBytes: 0,
			sessionId: 'aaaaaaaa-1111-4222-8333-444444444444',
			save: (name) => {
				saved.push(name)

				return Promise.resolve(`![[${name}]]`)
			},
			...extra,
		}),
	}
}

const renderOptions: RenderOptions = {
	foldToolCalls: true,
	toolOutput: 'full',
	truncateLines: 1,
	includeThinking: false,
	noteStyle: 'raw',
	machine: 'sample-host',
	resume: '',
	importedAt: new Date('2026-02-01T12:00:00.000Z'),
	redactHome: '/home/sample',
	redactSecrets: true,
	previous: { created: undefined, project: undefined },
}

let folder = ''

beforeAll(() => {
	folder = mkdtempSync(join(tmpdir(), 'tapedeck-images-'))
})

afterAll(() => {
	rmSync(folder, { recursive: true, force: true })
})

describe('resolveImages', () => {
	it('saves each image under a stable name and embeds it', async () => {
		const vault = fakeVault()
		const first = await resolveImages(parsed('claude-code'), vault.options({}))
		const again = await resolveImages(parsed('claude-code'), vault.options({}))

		assert.deepStrictEqual(imagesOf(first), imagesOf(again))
		assert.strictEqual(vault.saved.length, 4)
		assert.match(vault.saved[0] ?? '', /^tapedeck-aaaaaaaa-[0-9a-f]{12}\.png$/)
		assert.strictEqual(vault.saved[0], vault.saved[2])
		assert.isTrue(imagesOf(first).every((image) => image.kind === 'vault'))
	})

	it('writes the embed where [Image #1] was', async () => {
		const vault = fakeVault()

		const note = renderTranscriptNote(
			await resolveImages(parsed('claude-code'), vault.options({})),
			renderOptions,
		)

		const [pasted, read] = vault.saved

		assert.include(note, `## 🗣️ User · 09:00\n\n![[${pasted}]]\n\nmake the button look like this`)
		assert.include(note, `> ![[${read}]]`)
		assert.notInclude(note, '[Image #1]')
	})

	it('saves a repeated image once', async () => {
		const vault = fakeVault()
		const transcript = parsed('claude-code')
		const doubled = { ...transcript, turns: [...transcript.turns, ...transcript.turns] }
		await resolveImages(doubled, vault.options({}))

		assert.strictEqual(new Set(vault.saved).size, vault.saved.length)
	})

	it('leaves a note when images are off or too big', async () => {
		const off = await resolveImages(parsed('claude-code'), fakeVault().options({ enabled: false }))
		const capped = await resolveImages(parsed('claude-code'), fakeVault().options({ maxBytes: 10 }))

		assert.deepStrictEqual(imagesOf(off)[0], {
			kind: 'missing',
			reason: 'freeze-frame import is off',
		})
		const [cappedImage] = imagesOf(capped)
		assert.strictEqual(cappedImage?.kind, 'missing')
		assert.match(cappedImage?.kind === 'missing' ? cappedImage.reason : '', /over the 1 KB limit$/)
	})

	it('copies a local image file that still exists and notes one that is gone', async () => {
		const shot = join(folder, 'shot.png')
		writeFileSync(shot, Buffer.from('synthetic image bytes'))
		const transcript = parsed('codex')

		const pointed: Transcript = {
			...transcript,
			turns: transcript.turns.map((turn) => ({
				...turn,
				blocks: turn.blocks.map((block) =>
					block.kind === 'image' && block.label === '[Image #2]'
						? { ...block, source: { kind: 'file', path: shot } }
						: block,
				),
			})),
		}

		const vault = fakeVault()

		const kinds = imagesOf(await resolveImages(pointed, vault.options({}))).map(
			(image) => image.kind,
		)

		assert.deepStrictEqual(kinds, ['vault', 'vault', 'vault'])
		assert.isTrue(vault.saved.some((name) => name.endsWith('.png')))

		const gone = imagesOf(await resolveImages(transcript, fakeVault().options({})))
		assert.deepStrictEqual(gone[1], {
			kind: 'missing',
			reason: 'the file is no longer at /home/sample/shots/gone.png',
		})
	})

	it('reports a failed save instead of throwing', async () => {
		const failing = fakeVault().options({ save: () => Promise.reject(new Error('disk full')) })
		const [first] = imagesOf(await resolveImages(parsed('claude-code'), failing))
		assert.deepStrictEqual(first, { kind: 'missing', reason: 'could not save it (disk full)' })
	})
})
