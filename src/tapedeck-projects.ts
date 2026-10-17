/**
 * Where a session ran, as a project name: the main repository, plus the worktree when the session
 * ran in a git worktree. Pure helpers; the file system checks live in
 * `tapedeck-project-places.ts`.
 */

/** Project for a tape: the main repo and, for a worktree, the worktree's folder name. */
export interface ProjectPlace {
	readonly project: string
	readonly worktree: string | undefined
}

const segments = (path: string): Array<string> =>
	path.split(/[/\\]+/).filter((part) => part !== '' && !/^[A-Za-z]:$/.test(part))

/** Last folder of a path as a project, e.g. `/home/me/code/app` is `app`. */
export const placeFromFolder = (path: string): ProjectPlace | undefined => {
	const last = segments(path).at(-1)

	return last === undefined ? undefined : { project: last, worktree: undefined }
}

/**
 * Worktree layouts recognised from the path alone, for worktrees that no longer exist:
 * `…/worktrees/<repo>/<worktree>` (herdr and similar tools), `<repo>/.worktrees/<worktree>`, and
 * `<repo>-worktrees/<worktree>`.
 */
export const placeFromWorktreePath = (path: string): ProjectPlace | undefined => {
	const parts = segments(path)

	for (const index of parts.keys()) {
		const place = worktreeAt(parts, index)

		if (place !== undefined) {
			return place
		}
	}

	return undefined
}

const placeOf = (
	project: string | undefined,
	worktree: string | undefined,
): ProjectPlace | undefined =>
	project === undefined || worktree === undefined || project === ''
		? undefined
		: { project, worktree }

/** The worktree layout whose marker folder is `parts[index]`, if any. */
const worktreeAt = (parts: ReadonlyArray<string>, index: number): ProjectPlace | undefined => {
	const part = parts[index] ?? ''

	if (part === 'worktrees') {
		return placeOf(parts[index + 1], parts[index + 2])
	}

	if (part === '.worktrees') {
		return placeOf(parts[index - 1], parts[index + 1])
	}

	return part.endsWith('-worktrees')
		? placeOf(part.slice(0, -'-worktrees'.length), parts[index + 1])
		: undefined
}

/** Absolute `gitdir:` path from a worktree's `.git` file, resolving a relative one. */
const gitdirOf = (text: string, worktreeRoot: string): string | undefined => {
	const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1]

	if (gitdir === undefined) {
		return undefined
	}

	return /^([A-Za-z]:)?[/\\]/.test(gitdir) ? gitdir : `${worktreeRoot}/${gitdir}`
}

/**
 * Reads a worktree's `.git` file (`gitdir: <main>/.git/worktrees/<name>`). The project is the main
 * repo's folder and the worktree is the folder holding the `.git` file.
 */
export const placeFromGitFile = (text: string, worktreeRoot: string): ProjectPlace | undefined => {
	const gitdir = gitdirOf(text, worktreeRoot)
	const parts = segments(gitdir ?? '')
	const marker = parts.lastIndexOf('worktrees')

	if (marker < 2 || parts[marker - 1] !== '.git') {
		return undefined
	}

	const project = parts[marker - 2]
	const worktree = segments(worktreeRoot).at(-1)

	return project === undefined ? undefined : { project, worktree }
}

/**
 * Worktree guess from a Claude Code or Pi encoded folder name, after the home folder is stripped
 * (`herdr-worktrees-app-fix-login`): the part after `worktrees-` is `<repo>-<worktree>`. The
 * encoding loses where names break, so the repo is taken to be one word.
 */
export const placeFromEncodedName = (name: string): ProjectPlace | undefined => {
	const match = /(?:^|-)worktrees-([A-Za-z0-9_]+)-(.+)$/.exec(name)

	if (match?.[1] !== undefined && match[2] !== undefined) {
		return { project: match[1], worktree: match[2] }
	}

	return name === '' ? undefined : { project: name, worktree: undefined }
}

/** How Claude Code and Pi folder names compare: anything but letters and digits counts as `-`. */
export const encodedForm = (name: string): string => name.replace(/[^A-Za-z0-9]/g, '-')

/** Lists the folder names inside a folder. */
export type FolderLister = (folder: string) => Promise<ReadonlyArray<string>>

/** How far an encoded folder name resolved: the real folder, and the encoded tail left over. */
export interface EncodedMatch {
	readonly path: string
	readonly rest: string
}

const joinPath = (folder: string, name: string): string =>
	folder.endsWith('/') ? `${folder}${name}` : `${folder}/${name}`

/** Real folder names inside `folder` that could start `rest`, longest first. */
const candidates = async (
	folder: string,
	rest: string,
	list: FolderLister,
): Promise<Array<string>> => {
	const names = await list(folder).catch((): ReadonlyArray<string> => [])

	return names
		.filter((name) => {
			const form = encodedForm(name)

			return rest === form || rest.startsWith(`${form}-`)
		})
		.toSorted((a, b) => b.length - a.length)
}

interface Budget {
	calls: number
}

const walkEncoded = async (
	rest: string,
	list: FolderLister,
	root: string,
	budget: Budget,
): Promise<EncodedMatch> => {
	if (rest === '' || budget.calls <= 0) {
		return { path: root, rest }
	}

	budget.calls -= 1

	return tryCandidates(
		await candidates(root, rest, list),
		{ root, rest, list, budget },
		{
			path: root,
			rest,
		},
	)
}

interface WalkStep {
	readonly root: string
	readonly rest: string
	readonly list: FolderLister
	readonly budget: Budget
}

/** Tries each candidate folder in turn (backtracking), keeping the deepest partial match. */
const tryCandidates = async (
	names: ReadonlyArray<string>,
	step: WalkStep,
	best: EncodedMatch,
): Promise<EncodedMatch> => {
	const [name, ...others] = names

	if (name === undefined) {
		return best
	}

	const form = encodedForm(name)
	const remaining = step.rest === form ? '' : step.rest.slice(form.length + 1)
	const match = await walkEncoded(remaining, step.list, joinPath(step.root, name), step.budget)

	if (match.rest === '') {
		return match
	}

	return tryCandidates(others, step, match.rest.length < best.rest.length ? match : best)
}

/**
 * Walks real folders to undo a lossy Claude Code or Pi folder name such as `-home-me--work-my-app`
 * or `--home-me-.work-my-app--`, trying longer folder names first and backing off when a branch
 * dead-ends. Returns the deepest real folder reached and the encoded tail left over (a worktree
 * that was removed, say). At most 200 folders are listed.
 */
export const resolveEncodedFolder = async (
	encoded: string,
	list: FolderLister,
	root = '/',
): Promise<EncodedMatch> =>
	walkEncoded(encodedForm(encoded).replace(/^-+|-+$/g, ''), list, root, { calls: 200 })

/** The folder an encoded match stands for, with any unresolved tail as its last part. */
export const matchedPath = (match: EncodedMatch): string =>
	match.rest === '' ? match.path : joinPath(match.path, match.rest)

/** `app · fix-login` for a worktree, or just the project. */
export const placeLabel = (place: ProjectPlace): string =>
	place.worktree === undefined ? place.project : `${place.project} · ${place.worktree}`
