/**
 * Claude Code links each line to the one before it with `parentUuid`. Rewinding or editing a prompt
 * starts a new branch from an earlier line, but the old lines stay in the file, so file order alone
 * mixes abandoned turns into the live ones. The live thread is the chain from the last line back to
 * the root. A compaction boundary has no parent, so it hangs off the conversation line written just
 * before it.
 */

/** What thread selection reads from a Claude Code line. */
export interface ThreadLine {
	readonly uuid?: string
	readonly parentUuid?: string | null
	readonly subtype?: string
}

/** Lines from one abandoned branch, and the live line it branched off. */
export interface DeadBranch<Line> {
	readonly fork: Line | undefined
	readonly lines: ReadonlyArray<Line>
}

/** Live conversation lines in file order, and the branches the user moved away from. */
export interface ThreadSplit<Line> {
	readonly live: ReadonlyArray<Line>
	readonly dead: ReadonlyArray<DeadBranch<Line>>
}

const linesById = <Line extends ThreadLine>(all: ReadonlyArray<Line>): Map<string, Line> => {
	const byId = new Map<string, Line>()

	for (const line of all) {
		if (line.uuid !== undefined && !byId.has(line.uuid)) {
			byId.set(line.uuid, line)
		}
	}

	return byId
}

const parentLinks = <Line extends ThreadLine>(
	all: ReadonlyArray<Line>,
	isConversation: (line: Line) => boolean,
): Map<Line, Line> => {
	const byId = linesById(all)
	const parents = new Map<Line, Line>()
	let previous: Line | undefined

	for (const line of all) {
		const boundary = line.subtype === 'compact_boundary' ? previous : undefined

		const parent =
			line.parentUuid === undefined || line.parentUuid === null
				? boundary
				: byId.get(line.parentUuid)

		if (parent !== undefined && parent !== line) {
			parents.set(line, parent)
		}

		previous = isConversation(line) ? line : previous
	}

	return parents
}

/** A line and its ancestors, nearest first, stopping if the links ever loop. */
const lineage = <Line>(line: Line, parents: Map<Line, Line>): Array<Line> => {
	const seen = new Set<Line>()
	let current: Line | undefined = line

	while (current !== undefined && !seen.has(current)) {
		seen.add(current)
		current = parents.get(current)
	}

	return [...seen]
}

/** Finds the prompt a line answers (itself, if it is one), remembering every line it passes. */
const promptFinder = <Line>(
	parents: Map<Line, Line>,
	isPrompt: (line: Line) => boolean,
): ((line: Line) => Line | undefined) => {
	const promptOf = new Map<Line, Line | undefined>()

	return (line) => {
		const walked: Array<Line> = []
		let found: Line | undefined

		for (const ancestor of lineage(line, parents)) {
			if (promptOf.has(ancestor)) {
				found = promptOf.get(ancestor)
				break
			}

			walked.push(ancestor)

			if (isPrompt(ancestor)) {
				found = ancestor
				break
			}
		}

		for (const visited of walked) {
			promptOf.set(visited, found)
		}

		return found
	}
}

interface Thread<Line> {
	readonly parents: Map<Line, Line>
	readonly isLive: (line: Line) => boolean
	readonly isConversation: (line: Line) => boolean
	readonly isPrompt: (line: Line) => boolean
}

/** The first abandoned prompt above a dead line, and the live line the branch hangs off. */
interface BranchStart<Line> {
	readonly root: Line
	readonly fork: Line | undefined
}

const branchStart = <Line>(line: Line, thread: Thread<Line>): BranchStart<Line> => {
	let root = line

	for (const ancestor of lineage(line, thread.parents)) {
		if (thread.isLive(ancestor) && thread.isConversation(ancestor)) {
			return { root, fork: ancestor }
		}

		root = !thread.isLive(ancestor) && thread.isPrompt(ancestor) ? ancestor : root
	}

	return { root, fork: undefined }
}

/** Groups dead lines by the abandoned prompt that started their branch, in file order. */
const deadBranches = <Line>(
	dead: ReadonlyArray<Line>,
	thread: Thread<Line>,
): Array<DeadBranch<Line>> => {
	const branches = new Map<Line, { fork: Line | undefined; lines: Array<Line> }>()

	for (const line of dead) {
		const { root, fork } = branchStart(line, thread)
		const branch = branches.get(root) ?? { fork, lines: [] }
		branch.lines.push(line)
		branches.set(root, branch)
	}

	return [...branches.values()]
}

/**
 * Splits a session into the live thread and abandoned branches. A line is abandoned when the prompt
 * it answers is off the live chain, so parallel tool calls (which fork the chain too) stay with
 * their turn. Lines without ids, from older sessions, are all live.
 */
export const splitThread = <Line extends ThreadLine>(
	all: ReadonlyArray<Line>,
	isConversation: (line: Line) => boolean,
	isPrompt: (line: Line) => boolean,
): ThreadSplit<Line> => {
	const conversation = all.filter(isConversation)
	const leaf = conversation.at(-1)

	if (leaf?.uuid === undefined) {
		return { live: conversation, dead: [] }
	}

	const parents = parentLinks(all, isConversation)
	const active = new Set(lineage(leaf, parents))
	const nearestPrompt = promptFinder(parents, isPrompt)

	const isLive = (line: Line): boolean => {
		const prompt = nearestPrompt(line)

		return prompt === undefined || active.has(prompt)
	}

	const thread = { parents, isLive, isConversation, isPrompt }
	const dead = conversation.filter((line) => !isLive(line))

	return { live: conversation.filter(isLive), dead: deadBranches(dead, thread) }
}
