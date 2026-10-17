import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, assert, beforeAll, describe, it } from '@effect/vitest'

import { ProjectPlaces } from '#/src/tapedeck-project-places'
import {
	encodedForm,
	matchedPath,
	placeFromEncodedName,
	placeFromGitFile,
	placeFromWorktreePath,
	placeLabel,
	resolveEncodedFolder,
} from '#/src/tapedeck-projects'
import { projectText } from '#/src/tapedeck-tape-list'

describe('worktree paths', () => {
	it('reads the worktree layouts tools use', () => {
		assert.deepStrictEqual(placeFromWorktreePath('/home/sample/.herdr/worktrees/mixtape/side-b'), {
			project: 'mixtape',
			worktree: 'side-b',
		})

		assert.deepStrictEqual(
			placeFromWorktreePath('/home/sample/code/mixtape/.worktrees/rewind-button/src'),
			{
				project: 'mixtape',
				worktree: 'rewind-button',
			},
		)

		assert.deepStrictEqual(placeFromWorktreePath('C:\\code\\mixtape-worktrees\\rewind-button'), {
			project: 'mixtape',
			worktree: 'rewind-button',
		})

		assert.isUndefined(placeFromWorktreePath('/home/sample/code/mixtape'))
		assert.isUndefined(placeFromWorktreePath('/home/sample/worktrees/mixtape'))
	})

	it('reads gitdir lines from worktree .git files', () => {
		assert.deepStrictEqual(
			placeFromGitFile('gitdir: /home/sample/code/mixtape/.git/worktrees/side-b\n', '/w/side-b'),
			{ project: 'mixtape', worktree: 'side-b' },
		)

		assert.deepStrictEqual(
			placeFromGitFile('gitdir: ../../mixtape/.git/worktrees/b2\n', '/home/sample/wt/b2'),
			{ project: 'mixtape', worktree: 'b2' },
		)

		assert.isUndefined(
			placeFromGitFile('gitdir: /home/sample/mixtape/.git/modules/lib\n', '/x/lib'),
		)
		assert.isUndefined(placeFromGitFile('not a git file', '/x'))
	})

	it('guesses repo and worktree from an encoded folder name', () => {
		assert.deepStrictEqual(placeFromEncodedName('herdr-worktrees-mixtape-side-b'), {
			project: 'mixtape',
			worktree: 'side-b',
		})

		assert.deepStrictEqual(placeFromEncodedName('code-mixtape'), {
			project: 'code-mixtape',
			worktree: undefined,
		})
	})

	it('labels a worktree after its repo', () => {
		assert.strictEqual(placeLabel({ project: 'mixtape', worktree: 'side-b' }), 'mixtape · side-b')
		assert.strictEqual(placeLabel({ project: 'mixtape', worktree: undefined }), 'mixtape')
	})
})

describe('resolveEncodedFolder', () => {
	const tree = new Map<string, ReadonlyArray<string>>(
		Object.entries({
			'/': ['home'],
			'/home': ['sample'],
			'/home/sample': ['.herdr', 'rec', 'my-mixtape'],
			'/home/sample/.herdr': ['worktrees'],
			'/home/sample/.herdr/worktrees': ['mixtape'],
			'/home/sample/.herdr/worktrees/mixtape': [],
			'/home/sample/rec': ['notes'],
			'/home/sample/my-mixtape': ['web'],
		}),
	)

	const list = async (folder: string): Promise<ReadonlyArray<string>> =>
		tree.get(folder) ?? Promise.reject(new Error('missing'))

	it('undoes the dash encoding against real folders, backing off dead ends', async () => {
		const match = await resolveEncodedFolder('-home-sample-my-mixtape-web', list)
		assert.deepStrictEqual(match, { path: '/home/sample/my-mixtape/web', rest: '' })
		assert.strictEqual(encodedForm('.herdr'), '-herdr')
	})

	it('keeps the tail of a removed worktree', async () => {
		const match = await resolveEncodedFolder('-home-sample--herdr-worktrees-mixtape-side-b', list)
		assert.deepStrictEqual(match, { path: '/home/sample/.herdr/worktrees/mixtape', rest: 'side-b' })
		assert.strictEqual(matchedPath(match), '/home/sample/.herdr/worktrees/mixtape/side-b')
	})

	it('reads Pi folder names too', async () => {
		const match = await resolveEncodedFolder('--home-sample-.herdr-worktrees-mixtape--', list)
		assert.deepStrictEqual(match, { path: '/home/sample/.herdr/worktrees/mixtape', rest: '' })
	})
})

let home = ''

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), 'tapedeck-places-'))
	const main = join(home, 'code', 'mixtape')
	mkdirSync(join(main, '.git', 'worktrees', 'side-b'), { recursive: true })
	mkdirSync(join(main, 'packages', 'web'), { recursive: true })
	const worktree = join(home, '.herdr', 'worktrees', 'mixtape', 'side-b')
	mkdirSync(join(worktree, 'src'), { recursive: true })
	writeFileSync(join(worktree, '.git'), `gitdir: ${main}/.git/worktrees/side-b\n`)
	mkdirSync(join(home, '.git'))
	mkdirSync(join(home, 'scratch'))
})

afterAll(() => {
	rmSync(home, { recursive: true, force: true })
})

describe('ProjectPlaces', () => {
	it('folds worktree sessions under the main repo', async () => {
		const places = new ProjectPlaces(home)
		const cwd = join(home, '.herdr', 'worktrees', 'mixtape', 'side-b', 'src')
		assert.deepStrictEqual(await places.forCwd(cwd), { project: 'mixtape', worktree: 'side-b' })
	})

	it('names a removed worktree from its path', async () => {
		const places = new ProjectPlaces(home)
		const cwd = join(home, '.herdr', 'worktrees', 'mixtape', 'tracking-fix')
		assert.deepStrictEqual(await places.forCwd(cwd), {
			project: 'mixtape',
			worktree: 'tracking-fix',
		})
	})

	it('uses the repo root for a subfolder, but not a repo at home', async () => {
		const places = new ProjectPlaces(home)

		assert.deepStrictEqual(await places.forCwd(join(home, 'code', 'mixtape', 'packages', 'web')), {
			project: 'mixtape',
			worktree: undefined,
		})

		assert.deepStrictEqual(await places.forCwd(join(home, 'scratch')), {
			project: 'scratch',
			worktree: undefined,
		})
	})

	it('resolves encoded project folders before tapes are read', async () => {
		const places = new ProjectPlaces(home)
		const encoded = encodedForm(join(home, '.herdr', 'worktrees', 'mixtape', 'side-b'))
		const names = await readdir(home)
		assert.include(names, '.herdr')
		await places.prepareFolders([encoded])
		assert.deepStrictEqual(places.folder(encoded), { project: 'mixtape', worktree: 'side-b' })
	})

	it('shows the worktree beside the project in rows', () => {
		const row = { project: 'mixtape', worktree: 'side-b' }
		assert.strictEqual(projectText({ ...rowBase, ...row }), 'mixtape · side-b')
	})
})

const rowBase = {
	path: 'a',
	harness: 'claude-code' as const,
	emoji: '🟠',
	agent: 'Claude Code',
	shelf: 'Claude Code',
	modifiedAt: new Date(0),
	project: undefined,
	worktree: undefined,
	title: undefined,
	kind: undefined,
	sessionId: undefined,
	state: 'new' as const,
	notePath: undefined,
}
