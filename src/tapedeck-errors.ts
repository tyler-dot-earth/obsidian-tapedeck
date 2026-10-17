import { Schema } from 'effect'

/** Session file could not be read as the chosen harness format. */
export class TapedeckParseError extends Schema.TaggedError<TapedeckParseError>()(
	'TapedeckParseError',
	{
		message: Schema.String,
	},
) {}

/** Reading a session directory or file failed. */
export class TapedeckReadError extends Schema.TaggedError<TapedeckReadError>()(
	'TapedeckReadError',
	{
		message: Schema.String,
	},
) {}

/** Turns an unknown throw into a message for a tagged Tapedeck error. */
export const tapedeckErrorMessage = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause)
