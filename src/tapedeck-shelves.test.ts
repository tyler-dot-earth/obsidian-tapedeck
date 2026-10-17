import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import {
	defaultTapeShelves,
	expandHome,
	migratedDefaultShelves,
	sameShelves,
	shelfName,
	shelfRoot,
} from '#/src/tapedeck-shelves'

const home = join('/', 'home', 'sample')

describe('expandHome', () => {
	it('expands a bare or leading ~ with either separator', () => {
		assert.strictEqual(expandHome('~', home), home)
		assert.strictEqual(expandHome('~/.codex/sessions', home), join(home, '.codex', 'sessions'))
		assert.strictEqual(expandHome('~\\.claude\\projects', home), join(home, '.claude', 'projects'))
		assert.strictEqual(expandHome('~//a///b/', home), join(home, 'a', 'b'))
	})

	it('leaves other paths alone', () => {
		assert.strictEqual(expandHome('/srv/tapes', home), '/srv/tapes')
		assert.strictEqual(expandHome('~other/tapes', home), '~other/tapes')
		assert.strictEqual(expandHome('tapes/~/x', home), 'tapes/~/x')
		assert.strictEqual(expandHome('', home), '')
	})

	it('trims a shelf path before expanding it', () => {
		const shelf = { path: '  ~/tapes ', harness: 'auto', enabled: true } as const
		assert.strictEqual(shelfRoot(shelf, home), join(home, 'tapes'))
	})
})

describe('default tape shelves', () => {
	it('has one enabled shelf per harness at its usual folder', () => {
		assert.deepStrictEqual(
			defaultTapeShelves.map((shelf) => [shelf.harness, shelf.path, shelf.enabled]),
			[
				['claude-code', '~/.claude/projects', true],
				['codex', '~/.codex/sessions', true],
				['pi', '~/.pi/agent/sessions', true],
			],
		)
	})

	it('keeps paths portable until they are read', () => {
		assert.isTrue(defaultTapeShelves.every((shelf) => shelf.path.startsWith('~/')))
		assert.deepStrictEqual(
			defaultTapeShelves.map((shelf) => shelfRoot(shelf, home)),
			[
				join(home, '.claude', 'projects'),
				join(home, '.codex', 'sessions'),
				join(home, '.pi', 'agent', 'sessions'),
			],
		)
	})

	it('names a shelf by label, falling back to its path', () => {
		assert.strictEqual(
			shelfName({ path: '~/x', label: ' Work ', harness: 'pi', enabled: true }),
			'Work',
		)
		assert.strictEqual(shelfName({ path: '~/x', label: ' ', harness: 'pi', enabled: true }), '~/x')
		assert.strictEqual(shelfName({ path: '~/x', harness: 'pi', enabled: true }), '~/x')
	})
})

describe('migratedDefaultShelves', () => {
	it('is the defaults when no folder was customised', () => {
		assert.isTrue(sameShelves(migratedDefaultShelves({}), defaultTapeShelves))
		assert.isTrue(sameShelves(migratedDefaultShelves({ codexDirectory: '  ' }), defaultTapeShelves))
	})

	it('carries a customised folder onto that harness shelf', () => {
		const shelves = migratedDefaultShelves({ piDirectory: '/data/pi-sessions' })
		assert.deepStrictEqual(
			shelves.map((shelf) => shelf.path),
			['~/.claude/projects', '~/.codex/sessions', '/data/pi-sessions'],
		)
		assert.isFalse(sameShelves(shelves, defaultTapeShelves))
	})
})
