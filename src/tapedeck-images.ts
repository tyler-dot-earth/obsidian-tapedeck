import type { ImageBlock, ImageSource, TranscriptBlock } from '#/src/tapedeck-transcript'

/**
 * Pure image helpers shared by the parsers, the importer, and the renderer: data URLs, file names,
 * and placing an image where its `[Image #N]` placeholder sits in the text.
 */

const extensions: ReadonlyMap<string, string> = new Map([
	['image/png', 'png'],
	['image/jpeg', 'jpg'],
	['image/jpg', 'jpg'],
	['image/gif', 'gif'],
	['image/webp', 'webp'],
	['image/svg+xml', 'svg'],
	['image/bmp', 'bmp'],
	['image/avif', 'avif'],
])

/** File extension for an image MIME type. Unknown types fall back to `bin` so nothing is lost. */
export const imageExtension = (mimeType: string): string =>
	extensions.get(mimeType.toLowerCase().trim()) ?? 'bin'

/** Extension of a file path, lowercased, or `undefined` when it has none. */
export const pathExtension = (path: string): string | undefined => {
	const match = /\.([A-Za-z0-9]{1,8})$/.exec(path)

	return match?.[1]?.toLowerCase()
}

/**
 * Source for an image URL as harnesses store it: `data:<mime>;base64,<data>` becomes inline bytes,
 * `http(s)://` stays a link, and anything else is reported missing.
 */
export const imageFromUrl = (url: string): ImageSource => {
	const data = /^data:([^;,]+)((?:;[^;,]+)*);base64,(.*)$/s.exec(url)

	if (data !== null) {
		return { kind: 'inline', mimeType: data[1] ?? '', base64: data[3] ?? '' }
	}

	if (/^https?:\/\//i.test(url)) {
		return { kind: 'url', url }
	}

	return { kind: 'missing', reason: 'unsupported image reference' }
}

/** Image block helper. */
export const imageBlock = (source: ImageSource, label: string | undefined): ImageBlock => ({
	kind: 'image',
	source,
	label,
})

/** `[Image #3]`, the placeholder Claude Code and Codex put in the prompt text. */
export const imageLabel = (number: number): string => `[Image #${number}]`

const labelPattern = /\[Image #\d+\]/g

/**
 * Deterministic attachment name: a short tape id plus a hash of the bytes, so importing a tape
 * again finds the same file instead of writing a copy, and the same image twice is saved once.
 */
export const imageFileName = (
	sessionId: string,
	contentHash: string,
	extension: string,
): string => {
	const tape = sessionId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8) || 'tape'

	return `tapedeck-${tape}-${contentHash.slice(0, 12)}.${extension}`
}

/** Bytes of base64 data without decoding it, for the size cap. */
export const base64Size = (base64: string): number => {
	const clean = base64.replace(/\s/g, '')
	const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0

	return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

/** `1.5 MB`, `320 KB`. */
export const formatBytes = (bytes: number): string =>
	bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`

/** Text pieces and the labelled images that go between them. */
const splitText = (
	text: string,
	labelled: ReadonlyMap<string, ImageBlock>,
	placed: Set<string>,
): Array<TranscriptBlock> => {
	const out: Array<TranscriptBlock> = []
	let rest = 0

	for (const match of text.matchAll(labelPattern)) {
		const image = labelled.get(match[0])

		if (image !== undefined && !placed.has(match[0])) {
			placed.add(match[0])
			out.push({ kind: 'text', text: text.slice(rest, match.index) }, image)
			rest = match.index + match[0].length
		}
	}

	out.push({ kind: 'text', text: text.slice(rest) })

	return out.filter((block) => block.kind !== 'text' || block.text.trim() !== '')
}

/**
 * Moves each labelled image to where its placeholder sits in the message text, replacing the
 * placeholder, so `[Image #1] more like this` reads as the image followed by `more like this`.
 * Images whose label does not appear in the text stay where they were. Run per message.
 */
export const placeLabelledImages = (
	blocks: ReadonlyArray<TranscriptBlock>,
): Array<TranscriptBlock> => {
	const texts = blocks.flatMap((block) => (block.kind === 'text' ? [block.text] : []))
	const labelled = new Map<string, ImageBlock>()

	for (const block of blocks) {
		if (block.kind !== 'image' || block.label === undefined || labelled.has(block.label)) {
			continue
		}

		const { label } = block

		if (texts.some((text) => text.includes(label))) {
			labelled.set(label, block)
		}
	}

	if (labelled.size === 0) {
		return [...blocks]
	}

	const placed = new Set<string>()
	const moved = new Set<TranscriptBlock>(labelled.values())

	return blocks.flatMap((block): Array<TranscriptBlock> => {
		if (moved.has(block)) {
			return []
		}

		return block.kind === 'text' ? splitText(block.text, labelled, placed) : [block]
	})
}
