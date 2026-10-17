import { Option, Schema } from 'effect'

/** Decodes each jsonl line with `schema`, dropping lines that do not match. */
export const decodeJsonLines = <A>(
	schema: Schema.Codec<A, unknown>,
	lines: ReadonlyArray<string>,
): Array<A> => {
	const decode = Schema.decodeUnknownOption(Schema.fromJsonString(schema))
	const decoded: Array<A> = []

	for (const line of lines) {
		const value = decode(line)

		if (Option.isSome(value)) {
			decoded.push(value.value)
		}
	}

	return decoded
}

/** Indented JSON for tool inputs. Strings stay as-is. */
export const prettyJson = (value: Schema.Json): string =>
	Schema.is(Schema.String)(value) ? value : (JSON.stringify(value, null, 2) ?? '')

const AnyJson = Schema.fromJsonString(Schema.Json)

/** Pretty-prints a JSON string, or returns it unchanged when it is not JSON. */
export const prettyJsonString = (text: string): string =>
	Option.match(Schema.decodeUnknownOption(AnyJson)(text), {
		onNone: () => text,
		onSome: (value) => prettyJson(value),
	})

/** Text part of a content array as harnesses store it. */
export const TextPart = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
})

export type TextPart = Schema.Schema.Type<typeof TextPart>

/** Content that is either a string or an array of typed parts. */
export const TextContent = Schema.Union([Schema.String, Schema.Array(TextPart)])

export type TextContent = Schema.Schema.Type<typeof TextContent>

/** Joins the text parts of string-or-array content. */
export const textOf = (content: TextContent | undefined): string => {
	if (content === undefined) {
		return ''
	}

	if (Schema.is(Schema.String)(content)) {
		return content
	}

	return content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join('\n')
}

/** True when any line decodes as `schema` JSON. */
export const someLineMatches = <A>(
	schema: Schema.Codec<A, unknown>,
	lines: ReadonlyArray<string>,
): boolean => decodeJsonLines(schema, lines).length > 0
