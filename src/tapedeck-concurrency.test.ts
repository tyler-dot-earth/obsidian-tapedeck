import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { mapWithLimit, TimeSlicer } from '#/src/tapedeck-concurrency'

describe('TimeSlicer', () => {
	it.effect('lets queued work run once the slice is used up', () =>
		Effect.promise(async () => {
			let ran = false

			setTimeout(() => {
				ran = true
			}, 0)

			await new TimeSlicer(0).pause()
			assert.isTrue(ran)
		}),
	)

	it.effect('does not yield inside the slice', () =>
		Effect.promise(async () => {
			let ran = false

			setTimeout(() => {
				ran = true
			}, 0)

			await new TimeSlicer(60_000).pause()
			assert.isFalse(ran)
		}),
	)
})

describe('mapWithLimit', () => {
	it.effect('keeps input order', () =>
		Effect.promise(async () => {
			const doubled = await mapWithLimit([3, 1, 2], 2, async (value) => value * 2)
			assert.deepStrictEqual(doubled, [6, 2, 4])
		}),
	)
})
