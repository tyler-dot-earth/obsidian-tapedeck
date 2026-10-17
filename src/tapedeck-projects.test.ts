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
		assert.deepStrictEqual(placeFromWorktreePath('/home/sample/.herdr/worktrees/app/fix-login'), {
			project: 'app',
			worktree: 'fix-login',
		})

		assert.deepStrictEqual(placeFromWorktreePath('/home/sample/code/app/.worktrees/fix/src'), {
			project: 'app',
			worktree: 'fix',
		})

		assert.deepStrictEqual(placeFromWorktreePath('C:\\code\\app-worktrees\\fix'), {
			project: 'app',
			worktree: 'fix',
		})

		assert.isUndefined(placeFromWorktreePath('/home/sample/code/app'))
		assert.isUndefined(placeFromWorktreePath('/home/sample/worktrees/app'))
	})

	it('reads gitdir lines from worktree .git files', () => {
		assert.deepStrictEqual(
			placeFromGitFile('gitdir: /home/sample/code/app/.git/worktrees/fix-login\n', '/w/fix-login'),
			{ project: 'app', worktree: 'fix-login' },
		)

		assert.deepStrictEqual(
			placeFromGitFile('gitdir: ../../app/.git/worktrees/b2\n', '/home/sample/wt/b2'),
			{ project: 'app', worktree: 'b2' },
		)

		assert.isUndefined(placeFromGitFile('gitdir: /home/sample/app/.git/modules/lib\n', '/x/lib'))
		assert.isUndefined(placeFromGitFile('not a git file', '/x'))
	})

	it('guesses repo and worktree from an encoded folder name', () => {
		assert.deepStrictEqual(placeFromEncodedName('herdr-worktrees-app-fix-login'), {
			project: 'app',
			worktree: 'fix-login',
		})

		assert.deepStrictEqual(placeFromEncodedName('code-app'), {
			project: 'code-app',
			worktree: undefined,
		})
	})

	it('labels a worktree after its repo', () => {
		assert.strictEqual(placeLabel({ project: 'app', worktree: 'fix-login' }), 'app · fix-login')
		assert.strictEqual(placeLabel({ project: 'app', worktree: undefined }), 'app')
	})
})

describe('resolveEncodedFolder', () => {
	const tree = new Map<string, ReadonlyArray<string>>(
		Object.entries({
			'/': ['home'],
			'/home': ['sample'],
			'/home/sample': ['.herdr', 'my', 'my-app'],
			'/home/sample/.herdr': ['worktrees'],
			'/home/sample/.herdr/worktrees': ['app'],
			'/home/sample/.herdr/worktrees/app': [],
			'/home/sample/my': ['notes'],
			'/home/sample/my-app': ['web'],
		}),
	)

	const list = async (folder: string): Promise<ReadonlyArray<string>> =>
		tree.get(folder) ?? Promise.reject(new Error('missing'))

	it('undoes the dash encoding against real folders, backing off dead ends', async () => {
		const match = await resolveEncodedFolder('-home-sample-my-app-web', list)
		assert.deepStrictEqual(match, { path: '/home/sample/my-app/web', rest: '' })
		assert.strictEqual(encodedForm('.herdr'), '-herdr')
	})

	it('keeps the tail of a removed worktree', async () => {
		const match = await resolveEncodedFolder('-home-sample--herdr-worktrees-app-fix-login', list)
		assert.deepStrictEqual(match, { path: '/home/sample/.herdr/worktrees/app', rest: 'fix-login' })
		assert.strictEqual(matchedPath(match), '/home/sample/.herdr/worktrees/app/fix-login')
	})

	it('reads Pi folder names too', async () => {
		const match = await resolveEncodedFolder('--home-sample-.herdr-worktrees-app--', list)
		assert.deepStrictEqual(match, { path: '/home/sample/.herdr/worktrees/app', rest: '' })
	})
})

let home = ''

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), 'tapedeck-places-'))
	const main = join(home, 'code', 'app')
	mkdirSync(join(main, '.git', 'worktrees', 'fix-login'), { recursive: true })
	mkdirSync(join(main, 'packages', 'web'), { recursive: true })
	const worktree = join(home, '.herdr', 'worktrees', 'app', 'fix-login')
	mkdirSync(join(worktree, 'src'), { recursive: true })
	writeFileSync(join(worktree, '.git'), `gitdir: ${main}/.git/worktrees/fix-login\n`)
	mkdirSync(join(home, '.git'))
	mkdirSync(join(home, 'scratch'))
})

afterAll(() => {
	rmSync(home, { recursive: true, force: true })
})

describe('ProjectPlaces', () => {
	it('folds worktree sessions under the main repo', async () => {
		const places = new ProjectPlaces(home)
		const cwd = join(home, '.herdr', 'worktrees', 'app', 'fix-login', 'src')
		assert.deepStrictEqual(await places.forCwd(cwd), { project: 'app', worktree: 'fix-login' })
	})

	it('names a removed worktree from its path', async () => {
		const places = new ProjectPlaces(home)
		const cwd = join(home, '.herdr', 'worktrees', 'app', 'gone')
		assert.deepStrictEqual(await places.forCwd(cwd), { project: 'app', worktree: 'gone' })
	})

	it('uses the repo root for a subfolder, but not a repo at home', async () => {
		const places = new ProjectPlaces(home)

		assert.deepStrictEqual(await places.forCwd(join(home, 'code', 'app', 'packages', 'web')), {
			project: 'app',
			worktree: undefined,
		})

		assert.deepStrictEqual(await places.forCwd(join(home, 'scratch')), {
			project: 'scratch',
			worktree: undefined,
		})
	})

	it('resolves encoded project folders before tapes are read', async () => {
		const places = new ProjectPlaces(home)
		const encoded = encodedForm(join(home, '.herdr', 'worktrees', 'app', 'fix-login'))
		const names = await readdir(home)
		assert.include(names, '.herdr')
		await places.prepareFolders([encoded])
		assert.deepStrictEqual(places.folder(encoded), { project: 'app', worktree: 'fix-login' })
	})

	it('shows the worktree beside the project in rows', () => {
		const row = { project: 'app', worktree: 'fix-login' }
		assert.strictEqual(projectText({ ...rowBase, ...row }), 'app · fix-login')
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
