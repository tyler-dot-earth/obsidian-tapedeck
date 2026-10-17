const prefixed = (prefix: string, lines: ReadonlyArray<string>): Array<string> =>
	lines.map((line) => `${prefix}${line}`)

const commonPrefix = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): number => {
	let index = 0

	while (index < left.length && index < right.length && left[index] === right[index]) {
		index += 1
	}

	return index
}

const commonSuffix = (
	left: ReadonlyArray<string>,
	right: ReadonlyArray<string>,
	floor: number,
): number => {
	let count = 0

	while (
		count < left.length - floor &&
		count < right.length - floor &&
		left[left.length - 1 - count] === right[right.length - 1 - count]
	) {
		count += 1
	}

	return count
}

/** Small unified-style diff for a string replacement. Shared lines become context. */
export const replacementDiff = (path: string, before: string, after: string): string => {
	const left = before.split('\n')
	const right = after.split('\n')
	const head = commonPrefix(left, right)
	const tail = commonSuffix(left, right, head)

	return [
		`--- a/${path}`,
		`+++ b/${path}`,
		...prefixed(' ', left.slice(0, head)),
		...prefixed('-', left.slice(head, left.length - tail)),
		...prefixed('+', right.slice(head, right.length - tail)),
		...prefixed(' ', left.slice(left.length - tail)),
	].join('\n')
}

/** Diff for a whole new file. */
export const newFileDiff = (path: string, content: string): string =>
	['--- /dev/null', `+++ b/${path}`, ...prefixed('+', content.split('\n'))].join('\n')
