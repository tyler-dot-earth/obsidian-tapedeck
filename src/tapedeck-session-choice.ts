import { Effect, Result } from 'effect'

import { localDate, localTime } from '#/src/tapedeck-filename'
import { parseSession } from '#/src/tapedeck-importer'
import type { SessionChoice } from '#/src/tapedeck-modals'
import { readSessionFile, type SessionFile } from '#/src/tapedeck-session-files'

/** Picker row: source emoji, when the file last changed, and the first prompt. */
export const sessionChoice = async (file: SessionFile): Promise<SessionChoice> => {
	const when = `${localDate(file.modifiedAt)} ${localTime(file.modifiedAt)}`
	const text = await Effect.runPromise(readSessionFile(file.path)).catch(() => '')
	const parsed = parseSession(text, file.source)
	const title = Result.isSuccess(parsed) ? parsed.success.title : 'unreadable session'

	return { label: `${file.source.emoji} ${when} · ${title}`, file }
}
