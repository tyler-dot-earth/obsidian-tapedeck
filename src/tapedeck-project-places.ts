import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

import {
	matchedPath,
	placeFromFolder,
	placeFromGitFile,
	placeFromWorktreePath,
	type ProjectPlace,
	resolveEncodedFolder,
} from '#/src/tapedeck-projects'

const folderNames = async (folder: string): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(folder, { withFileTypes: true })

	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

/** What the nearest `.git` above a folder says. */
type GitMark =
	| { readonly kind: 'worktree'; readonly place: ProjectPlace }
	| { readonly kind: 'repo'; readonly root: string }
	| { readonly kind: 'none' }

/**
 * Project names from the file system: worktree `.git` files, repo roots, and real folders behind
 * Claude Code and Pi encoded folder names. Results are kept for the life of the plugin.
 */
export class ProjectPlaces {
	private readonly home: string
	private readonly cwds = new Map<string, Promise<ProjectPlace | undefined>>()
	private readonly folders = new Map<string, ProjectPlace | undefined>()

	constructor(home: string = homedir()) {
		this.home = home
	}

	/**
	 * Project for a session's cwd: the main repo for a worktree (from its `.git` file, or the path
	 * when the worktree is gone), else the repo root, else the cwd's own folder. A repo at the home
	 * folder (dotfiles) does not count.
	 */
	async forCwd(cwd: string): Promise<ProjectPlace | undefined> {
		const known = this.cwds.get(cwd)

		if (known !== undefined) {
			return known
		}

		const place = this.lookUp(cwd)
		this.cwds.set(cwd, place)

		return place
	}

	private async lookUp(cwd: string): Promise<ProjectPlace | undefined> {
		const mark = await this.gitMark(cwd)

		if (mark.kind === 'worktree') {
			return mark.place
		}

		return placeFromWorktreePath(cwd) ?? placeFromFolder(mark.kind === 'repo' ? mark.root : cwd)
	}

	/** The nearest `.git` at or above `folder`, stopping below the home folder. */
	private async gitMark(folder: string): Promise<GitMark> {
		if (folder === this.home || dirname(folder) === folder) {
			return { kind: 'none' }
		}

		const mark = await this.markAt(folder)

		return mark.kind === 'none' ? this.gitMark(dirname(folder)) : mark
	}

	private async markAt(folder: string): Promise<GitMark> {
		const git = join(folder, '.git')
		const info = await stat(git).catch(() => undefined)

		if (info === undefined) {
			return { kind: 'none' }
		}

		if (info.isDirectory()) {
			return { kind: 'repo', root: folder }
		}

		const text = await readFile(git, 'utf8').catch(() => '')
		const place = placeFromGitFile(text, folder)

		return place === undefined ? { kind: 'repo', root: folder } : { kind: 'worktree', place }
	}

	/** Resolves Claude Code and Pi project folder names against real folders, once each. */
	async prepareFolders(names: ReadonlyArray<string>): Promise<void> {
		const pending = [...new Set(names)].filter((name) => !this.folders.has(name))
		const places = await Promise.all(pending.map(async (name) => this.resolveFolder(name)))

		for (const [index, name] of pending.entries()) {
			this.folders.set(name, places[index])
		}
	}

	private async resolveFolder(name: string): Promise<ProjectPlace | undefined> {
		if (sep !== '/') {
			return undefined
		}

		const match = await resolveEncodedFolder(name, folderNames)

		if (!match.path.startsWith(`${this.home}/`)) {
			return undefined
		}

		const path = matchedPath(match)

		return match.rest === ''
			? this.forCwd(path)
			: (placeFromWorktreePath(path) ?? placeFromFolder(path))
	}

	/** The resolved project for an encoded folder name, if `prepareFolders` found one. */
	folder(name: string): ProjectPlace | undefined {
		return this.folders.get(name)
	}
}
