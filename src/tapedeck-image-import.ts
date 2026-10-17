import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

import { tapedeckErrorMessage } from '#/src/tapedeck-errors'
import {
	base64Size,
	formatBytes,
	imageExtension,
	imageFileName,
	pathExtension,
} from '#/src/tapedeck-images'
import type {
	ImageSource,
	Transcript,
	TranscriptBlock,
	TranscriptTurn,
} from '#/src/tapedeck-transcript'

/** How images in a tape are turned into vault attachments. */
export interface ImageImportOptions {
	readonly enabled: boolean
	/** Largest image to save, in bytes. 0 or less means no limit. */
	readonly maxBytes: number
	readonly sessionId: string
	/**
	 * Writes `bytes` as the attachment `name`, or reuses the file already there under that name, and
	 * returns the embed to put in the note.
	 */
	readonly save: (name: string, bytes: Uint8Array) => Promise<string>
}

const missing = (reason: string): ImageSource => ({ kind: 'missing', reason })

const tooBig = (size: number, maxBytes: number): ImageSource | undefined =>
	maxBytes > 0 && size > maxBytes
		? missing(`${formatBytes(size)} is over the ${formatBytes(maxBytes)} limit`)
		: undefined

/** Saves each distinct attachment once, even when a tape repeats an image. */
type SaveOnce = (name: string, bytes: Uint8Array) => Promise<string>

const saveOnce = (options: ImageImportOptions): SaveOnce => {
	const saving = new Map<string, Promise<string>>()

	return (name, bytes) => {
		const pending = saving.get(name) ?? options.save(name, bytes)
		saving.set(name, pending)

		return pending
	}
}

const saveBytes = async (
	bytes: Uint8Array,
	extension: string,
	options: ImageImportOptions,
	save: SaveOnce,
): Promise<ImageSource> => {
	if (bytes.length === 0) {
		return missing('the image data is empty')
	}

	const hash = createHash('sha256').update(bytes).digest('hex')
	const name = imageFileName(options.sessionId, hash, extension)

	try {
		return { kind: 'vault', embed: await save(name, bytes) }
	} catch (error) {
		return missing(`could not save it (${tapedeckErrorMessage(error)})`)
	}
}

const fromFile = async (
	path: string,
	options: ImageImportOptions,
	save: SaveOnce,
): Promise<ImageSource> => {
	const info = await stat(path).catch(() => undefined)

	if (info?.isFile() !== true) {
		return missing(`the file is no longer at ${path}`)
	}

	const limited = tooBig(info.size, options.maxBytes)

	if (limited !== undefined) {
		return limited
	}

	const bytes = await readFile(path).catch(() => undefined)

	return bytes === undefined
		? missing(`could not read ${path}`)
		: saveBytes(bytes, pathExtension(path) ?? 'png', options, save)
}

const resolveSource = (
	source: ImageSource,
	options: ImageImportOptions,
	save: SaveOnce,
): Promise<ImageSource> => {
	if (source.kind !== 'inline' && source.kind !== 'file') {
		return Promise.resolve(source)
	}

	if (!options.enabled) {
		return Promise.resolve(missing('freeze-frame import is off'))
	}

	if (source.kind === 'file') {
		return fromFile(source.path, options, save)
	}

	const limited = tooBig(base64Size(source.base64), options.maxBytes)

	return limited === undefined
		? saveBytes(
				Buffer.from(source.base64, 'base64'),
				imageExtension(source.mimeType),
				options,
				save,
			)
		: Promise.resolve(limited)
}

const resolveBlock = async (
	block: TranscriptBlock,
	options: ImageImportOptions,
	save: SaveOnce,
): Promise<TranscriptBlock> => {
	if (block.kind === 'image') {
		return { ...block, source: await resolveSource(block.source, options, save) }
	}

	if (block.kind === 'tool' && block.images.length > 0) {
		const images = await Promise.all(
			block.images.map((image) => resolveSource(image, options, save)),
		)

		return { ...block, images }
	}

	return block
}

const resolveTurn = async (
	turn: TranscriptTurn,
	options: ImageImportOptions,
	save: SaveOnce,
): Promise<TranscriptTurn> => ({
	...turn,
	blocks: await Promise.all(turn.blocks.map((block) => resolveBlock(block, options, save))),
})

/**
 * Saves every inline or file image in a tape as an attachment and swaps it for its embed. Images
 * that are switched off, over the size limit, gone from disk, or fail to save become a `missing`
 * source with the reason, so the note says what happened instead of throwing.
 */
export const resolveImages = async (
	transcript: Transcript,
	options: ImageImportOptions,
): Promise<Transcript> => {
	const save = saveOnce(options)

	return {
		...transcript,
		turns: await Promise.all(transcript.turns.map((turn) => resolveTurn(turn, options, save))),
		abandoned: await Promise.all(
			transcript.abandoned.map(async (branch) => ({
				after: branch.after,
				turns: await Promise.all(branch.turns.map((turn) => resolveTurn(turn, options, save))),
			})),
		),
	}
}
