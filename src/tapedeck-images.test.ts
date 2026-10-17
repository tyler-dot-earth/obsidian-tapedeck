import { readFileSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Result } from 'effect'

import {
	base64Size,
	formatBytes,
	imageExtension,
	imageFileName,
	imageFromUrl,
	pathExtension,
	placeLabelledImages,
} from '#/src/tapedeck-images'
import { renderImage } from '#/src/tapedeck-render'
import { claudeCodeSource } from '#/src/tapedeck-source-claude-code'
import { codexSource } from '#/src/tapedeck-source-codex'
import { piSource } from '#/src/tapedeck-source-pi'
import type {
	ImageSource,
	Transcript,
	TranscriptBlock,
	TranscriptSource,
} from '#/src/tapedeck-transcript'

/** Synthetic 2×2 red PNG, the same bytes the image fixtures use. */
const red =
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII='

const render = (source: ImageSource): string => renderImage(source, '[Image #1]')

const parsed = (source: TranscriptSource, name: string): Transcript =>
	Result.getOrThrow(source.parse(readFileSync(`fixtures/images/${name}.jsonl`, 'utf8')))

/** Compact view of blocks: text, image label + kind, or tool name + image count. */
const blockSummary = (blocks: ReadonlyArray<TranscriptBlock>): Array<string> =>
	blocks.map((block): string => {
		if (block.kind === 'text') {
			return `text:${block.text.trim()}`
		}

		if (block.kind === 'image') {
			return `image:${block.label ?? '-'}:${block.source.kind}`
		}

		return block.kind === 'tool'
			? `tool:${block.name}:${block.images.map((image) => image.kind).join(',')}`
			: block.kind
	})

describe('image helpers', () => {
	it('reads data URLs and leaves other URLs as links', () => {
		assert.deepStrictEqual(imageFromUrl(`data:image/png;base64,${red}`), {
			kind: 'inline',
			mimeType: 'image/png',
			base64: red,
		})

		assert.deepStrictEqual(imageFromUrl('https://example.com/a.png'), {
			kind: 'url',
			url: 'https://example.com/a.png',
		})

		assert.strictEqual(imageFromUrl('file_abc').kind, 'missing')
	})

	it('names attachments by tape and content hash', () => {
		assert.strictEqual(
			imageFileName('aaaaaaaa-1111-4222', '0123456789abcdef0123', 'png'),
			'tapedeck-aaaaaaaa-0123456789ab.png',
		)

		assert.strictEqual(imageExtension('image/JPEG'), 'jpg')
		assert.strictEqual(imageExtension('application/x-weird'), 'bin')
		assert.strictEqual(pathExtension('/a/b/Shot.PNG'), 'png')
		assert.isUndefined(pathExtension('/a/b/noext'))
	})

	it('measures base64 without decoding it', () => {
		assert.strictEqual(base64Size(red), Buffer.from(red, 'base64').length)
		assert.strictEqual(base64Size('YQ=='), 1)
		assert.strictEqual(formatBytes(2 * 1024 * 1024), '2.0 MB')
		assert.strictEqual(formatBytes(300), '1 KB')
	})

	it('moves a labelled image to its placeholder', () => {
		const image: TranscriptBlock = {
			kind: 'image',
			source: { kind: 'vault', embed: '![[a.png]]' },
			label: '[Image #1]',
		}

		assert.deepStrictEqual(
			blockSummary(placeLabelledImages([{ kind: 'text', text: 'see [Image #1] here' }, image])),
			['text:see', 'image:[Image #1]:vault', 'text:here'],
		)

		const unlabelled = { ...image, label: '[Image #2]' }

		assert.deepStrictEqual(
			blockSummary(placeLabelledImages([{ kind: 'text', text: 'no placeholder' }, unlabelled])),
			['text:no placeholder', 'image:[Image #2]:vault'],
		)
	})

	it('renders saved, remote, and missing images', () => {
		assert.strictEqual(render({ kind: 'vault', embed: '![[a.png]]' }), '![[a.png]]')
		assert.strictEqual(
			render({ kind: 'url', url: 'https://x.test/a.png' }),
			'[🖼️ [Image #1]](https://x.test/a.png)',
		)

		assert.strictEqual(
			render({ kind: 'missing', reason: 'too big' }),
			'*⏸️ [Image #1] not imported: too big*',
		)
	})
})

describe('images in sessions', () => {
	it('Claude Code: pasted image replaces its placeholder, tool results keep theirs', () => {
		const [user, assistant] = parsed(claudeCodeSource, 'claude-code').turns
		assert.deepStrictEqual(blockSummary(user?.blocks ?? []), [
			'image:[Image #1]:inline',
			'text:make the button look like this',
		])

		assert.include(blockSummary(assistant?.blocks ?? []), 'tool:Read:inline')
		assert.strictEqual(
			parsed(claudeCodeSource, 'claude-code').title,
			'make the button look like this',
		)
	})

	it('Codex: data URL images inline, tagged local images fall back to their path', () => {
		const [user, assistant] = parsed(codexSource, 'codex').turns
		assert.deepStrictEqual(blockSummary(user?.blocks ?? []), [
			'text:Why does',
			'image:[Image #1]:inline',
			'text:show an error but',
			'image:[Image #2]:file',
			'text:does not?',
		])

		assert.include(blockSummary(assistant?.blocks ?? []), 'tool:view_image:inline')
	})

	it('Pi: inline images in user messages and tool results', () => {
		const [user, assistant] = parsed(piSource, 'pi').turns
		assert.deepStrictEqual(blockSummary(user?.blocks ?? []), [
			'text:Match this palette',
			'image:-:inline',
		])
		assert.include(blockSummary(assistant?.blocks ?? []), 'tool:read:inline')
	})
})
