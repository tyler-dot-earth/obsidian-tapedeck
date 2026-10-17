import type { Transcript } from '#/src/tapedeck-transcript'

/** Default note name: `2026-01-31 claude-code Fix the flaky test`. */
export const defaultFilenamePattern = '{date} {harness} {title}'

const pad = (value: number): string => String(value).padStart(2, '0')

/** Local `YYYY-MM-DD`. */
export const localDate = (date: Date): string =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Local `HH:mm`. */
export const localTime = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** Local `YYYY-MM-DDTHH:mm:ss`, the shape Obsidian date-time properties read. */
export const localDateTime = (date: Date): string =>
	`${localDate(date)}T${localTime(date)}:${pad(date.getSeconds())}`

/** Parses an ISO timestamp, or undefined when it is missing or invalid. */
export const parseTimestamp = (value: string | undefined): Date | undefined => {
	if (value === undefined) {
		return undefined
	}

	const date = new Date(value)

	return Number.isNaN(date.getTime()) ? undefined : date
}

const maxLength = 120

/** Strips characters Obsidian and common file systems reject in note names. */
export const sanitizeFilename = (name: string): string => {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')

	return cleaned.slice(0, maxLength).trim() || 'transcript'
}

/** Fills `{date}`, `{time}`, `{harness}`, `{session}`, and `{title}`. */
export const transcriptFilename = (
	pattern: string,
	transcript: Transcript,
	fallbackDate: Date,
): string => {
	const date = parseTimestamp(transcript.startedAt) ?? fallbackDate

	const tokens = new Map([
		['date', localDate(date)],
		['time', localTime(date).replace(':', '')],
		['harness', transcript.harness],
		['session', transcript.sessionId.slice(0, 8)],
		['title', transcript.title],
	])

	const filled = (pattern.trim() || defaultFilenamePattern).replace(
		/\{(\w+)\}/g,
		(match, token: string) => tokens.get(token) ?? match,
	)

	return sanitizeFilename(filled)
}
