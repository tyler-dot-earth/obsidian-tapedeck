import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, assert, beforeAll, describe, it } from '@effect/vitest'
import { Effect, type Schema } from 'effect'

import { CodexThreadNames, codexIndexPath } from '#/src/tapedeck-codex-names'
import { listSessionFiles, type SessionFile } from '#/src/tapedeck-session-files'
import { defaultTapeShelves } from '#/src/tapedeck-shelves'
import { TapeInfoCache, tapeRow } from '#/src/tapedeck-tape-info'
import { filterTapes } from '#/src/tapedeck-tape-list'

/** Synthetic tapes covering every title source and the files lists leave out. */

let home = ''

const ids = {
	named: '0a000000-0000-4000-8000-000000000001',
	empty: '0a000000-0000-4000-8000-000000000002',
	clear: '0a000000-0000-4000-8000-000000000003',
	codex: '019a0000-0000-7000-8000-000000000004',
	codexChild: '019a0000-0000-7000-8000-000000000005',
	pi: '0a000000-0000-4000-8000-000000000006',
}

const lines = (...values: ReadonlyArray<Schema.Json>): string =>
	`${values.map((value) => JSON.stringify(value)).join('\n')}\n`

const claudeUser = (content: string, uuid: string, sessionId = ids.named): Schema.Json => ({
	type: 'user',
	sessionId,
	uuid,
	cwd: '/home/sample/projects/demo',
	timestamp: '2026-01-15T09:00:01.000Z',
	message: { role: 'user', content },
})

/** A long tape: the generated title sits past the first 1 MB, where the head never reaches. */
const namedClaudeTape = (): string => {
	const filler = Array.from({ length: 40 }, (_, index) =>
		claudeUser(`Step ${index} ${'x'.repeat(30_000)}`, `f${index}`),
	)

	return lines(
		claudeUser('<command-name>/clear</command-name><command-args></command-args>', 'u0'),
		claudeUser('Make the greeting say hello world', 'u1'),
		...filler,
		{ type: 'ai-title', aiTitle: 'Greeting says hello', sessionId: ids.named },
		{ type: 'last-prompt', lastPrompt: 'thanks', sessionId: ids.named },
	)
}

const system = (sessionId: string): Schema.Json => ({
	type: 'system',
	subtype: 'informational',
	sessionId,
	cwd: '/home/sample/projects/demo',
	content: 'Session started',
})

const codexMeta = (id: string, parent: string | null): Schema.Json => ({
	timestamp: '2026-03-01T08:00:00.000Z',
	type: 'session_meta',
	payload: { id, cwd: '/home/sample/projects/demo', parent_thread_id: parent },
})

const codexUser = (text: string): Schema.Json => ({
	type: 'response_item',
	payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
})

const write = (path: string, text: string): void => {
	mkdirSync(join(path, '..'), { recursive: true })
	writeFileSync(path, text)
}

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), 'tapedeck-titles-'))
	const claude = join(home, '.claude', 'projects', '-home-sample--work-demo')
	write(join(claude, `${ids.named}.jsonl`), namedClaudeTape())
	write(join(claude, `${ids.empty}.jsonl`), lines(system(ids.empty), { type: 'mode', mode: 'x' }))

	write(
		join(claude, `${ids.clear}.jsonl`),
		lines(
			claudeUser(
				'<command-name>/clear</command-name><command-args></command-args>',
				'c1',
				ids.clear,
			),
		),
	)

	const day = join(home, '.codex', 'sessions', '2026', '03', '01')

	write(
		join(day, `rollout-2026-03-01T08-00-00-${ids.codex}.jsonl`),
		lines(
			codexMeta(ids.codex, null),
			codexUser('# AGENTS.md instructions for /home/sample/projects/demo\n\nUse tabs.'),
			codexUser('<environment_context><cwd>/home/sample</cwd></environment_context>'),
			codexUser('Add a dark mode toggle'),
		),
	)

	write(
		join(day, `rollout-2026-03-01T08-05-00-${ids.codexChild}.jsonl`),
		lines(
			codexMeta(ids.codexChild, ids.codex),
			codexUser('The following is the Codex agent history whose request you are reviewing.'),
		),
	)

	write(
		join(home, '.codex', 'session_index.jsonl'),
		lines(
			{ id: ids.codex, thread_name: 'Dark mode', updated_at: '2026-03-01T08:01:00Z' },
			{ id: ids.codex, thread_name: 'Dark mode toggle', updated_at: '2026-03-01T08:02:00Z' },
		),
	)

	write(
		join(
			home,
			'.pi',
			'agent',
			'sessions',
			'--home-sample-projects-demo--',
			`2026-04-01T10-00-00-000Z_${ids.pi}.jsonl`,
		),
		lines(
			{
				type: 'session',
				version: 3,
				id: ids.pi,
				timestamp: '2026-04-01T10:00:00.000Z',
				cwd: '/home/sample/projects/demo',
			},
			{
				type: 'message',
				id: 'm1',
				parentId: null,
				timestamp: '2026-04-01T10:00:01.000Z',
				message: { role: 'user', content: [{ type: 'text', text: 'Sort the list' }] },
			},
			{
				type: 'session_info',
				id: 'i1',
				parentId: 'm1',
				timestamp: '2026-04-01T10:00:02.000Z',
				name: 'Sorting',
			},
		),
	)
})

afterAll(() => {
	rmSync(home, { recursive: true, force: true })
})

const tapes = (): Promise<ReadonlyArray<SessionFile>> =>
	Effect.runPromise(listSessionFiles(defaultTapeShelves, home))

const tape = async (id: string): Promise<SessionFile> => {
	const found = (await tapes()).find((file) => file.path.includes(id))

	if (found === undefined) {
		throw new Error(`no tape ${id}`)
	}

	return found
}

describe('tape titles from files', () => {
	it('takes a Claude Code title from the tail of a long tape', async () => {
		const info = await new TapeInfoCache().read(await tape(ids.named))
		assert.strictEqual(info.title, 'Greeting says hello')
		assert.strictEqual(info.titleSource, 'name')
		assert.strictEqual(info.kind, 'session')
	})

	it('marks a Claude Code file with no messages as empty', async () => {
		const info = await new TapeInfoCache().read(await tape(ids.empty))
		assert.strictEqual(info.kind, 'empty')
		assert.strictEqual(info.title, 'empty tape')
		assert.strictEqual(info.cwd, '/home/sample/projects/demo')
	})

	it('names a tape that only ran a command after the command', async () => {
		const info = await new TapeInfoCache().read(await tape(ids.clear))
		assert.strictEqual(info.title, '/clear only')
		assert.strictEqual(info.titleSource, 'fallback')
	})

	it('uses the Codex thread name, following renames without re-reading', async () => {
		const file = await tape(ids.codex)
		const names = new CodexThreadNames()
		const cache = new TapeInfoCache(names)
		await cache.prepare([file])
		assert.strictEqual((await cache.read(file)).title, 'Dark mode toggle')
		assert.strictEqual(codexIndexPath(file.path), join(home, '.codex', 'session_index.jsonl'))

		const unnamed = await new TapeInfoCache().read(file)
		assert.strictEqual(unnamed.title, 'Add a dark mode toggle')
		assert.strictEqual(unnamed.titleSource, 'prompt')
	})

	it('marks Codex subagent threads and leaves them and empty files out of lists', async () => {
		const cache = new TapeInfoCache()
		const files = await tapes()
		const infos = await Promise.all(files.map(async (file) => cache.read(file)))
		const child = files.findIndex((file) => file.path.includes(ids.codexChild))
		assert.strictEqual(infos[child]?.kind, 'subagent')

		const rows = files.map((file, index) => tapeRow(file, infos[index], () => undefined, home))
		const listed = new Set(filterTapes(rows, '').map((row) => row.sessionId))
		assert.isFalse(listed.has(ids.codexChild))
		assert.isFalse(listed.has(ids.empty))
		assert.isTrue(listed.has(ids.clear))
		assert.strictEqual(rows.find((row) => row.sessionId === ids.empty)?.project, 'demo')
	})

	it('reads the Pi session name', async () => {
		const info = await new TapeInfoCache().read(await tape(ids.pi))
		assert.strictEqual(info.title, 'Sorting')
	})
})
