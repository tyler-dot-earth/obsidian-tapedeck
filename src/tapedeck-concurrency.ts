/**
 * Maps `items` through `task` with at most `limit` running at once, keeping input order in the
 * result. Used for reading tape headers and importing many tapes without flooding the disk.
 */
export const mapWithLimit = <A, B>(
	items: ReadonlyArray<A>,
	limit: number,
	task: (item: A) => Promise<B>,
): Promise<Array<B>> => {
	const results: Array<{ readonly index: number; readonly value: B }> = []
	let next = 0

	const worker = (): Promise<void> => {
		const index = next
		const item = items[index]

		if (index >= items.length || item === undefined) {
			return Promise.resolve()
		}

		next += 1

		return task(item).then((result) => {
			results.push({ index, value: result })

			return worker()
		})
	}

	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)

	return Promise.all(workers).then(() =>
		results.toSorted((left, right) => left.index - right.index).map((entry) => entry.value),
	)
}
