import { Schema } from 'effect'

/** Session file could not be read as the chosen harness format. */
export class DailiesParseError extends Schema.TaggedError<DailiesParseError>()(
	'DailiesParseError',
	{
		message: Schema.String,
	},
) {}

/** Reading a session directory or file failed. */
export class DailiesReadError extends Schema.TaggedError<DailiesReadError>()('DailiesReadError', {
	message: Schema.String,
}) {}

/** Turns an unknown throw into a message for a tagged Dailies error. */
export const dailiesErrorMessage = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause)
