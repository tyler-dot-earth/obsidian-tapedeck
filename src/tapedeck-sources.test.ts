import { readFileSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Result } from 'effect'

import { claudeCodeSource } from '#/src/tapedeck-source-claude-code'
import { codexSource } from '#/src/tapedeck-source-codex'
import { piSource } from '#/src/tapedeck-source-pi'
import { detectSource } from '#/src/tapedeck-sources'
import type { ToolBlock, Transcript, TranscriptSource } from '#/src/tapedeck-transcript'

const fixtures = {
	claude:
		'fixtures/claude-code/-home-sample-projects-mixtape/11111111-2222-4333-8444-555555555555.jsonl',
	codex:
		'fixtures/codex/2026/01/15/rollout-2026-01-15T10-00-00-019a0000-aaaa-7bbb-8ccc-dddddddddddd.jsonl',
	pi: 'fixtures/pi/--home-sample-projects-mixtape--/2026-01-15T11-00-00-000Z_33333333-4444-4555-8666-777777777777.jsonl',
}

const read = (path: string): string => readFileSync(path, 'utf8')

const parsed = (source: TranscriptSource, path: string): Transcript => {
	const result = source.parse(read(path))
	assert.isTrue(Result.isSuccess(result))

	return Result.getOrThrow(result)
}

const tools = (transcript: Transcript): Array<ToolBlock> =>
	transcript.turns.flatMap((turn) =>
		turn.blocks.flatMap((block) => (block.kind === 'tool' ? [block] : [])),
	)

describe('detectSource', () => {
	it('recognises each fixture', () => {
		assert.strictEqual(detectSource(read(fixtures.claude))?.harness, 'claude-code')
		assert.strictEqual(detectSource(read(fixtures.codex))?.harness, 'codex')
		assert.strictEqual(detectSource(read(fixtures.pi))?.harness, 'pi')
		assert.isUndefined(detectSource('{"hello":"world"}\n'))
	})

	it('matches each source path layout', () => {
		assert.isTrue(claudeCodeSource.matchesFile('-home-sample/abc.jsonl'))
		assert.isFalse(claudeCodeSource.matchesFile('-home-sample/abc/subagents/x.jsonl'))
		assert.isTrue(codexSource.matchesFile('2026/01/15/rollout-x.jsonl'))
		assert.isFalse(codexSource.matchesFile('2026/01/15/other.jsonl'))
		assert.isTrue(piSource.matchesFile('--home-sample--/2026_x.jsonl'))
	})
})

describe('Claude Code source', () => {
	const transcript = parsed(claudeCodeSource, fixtures.claude)

	it('reads session metadata', () => {
		assert.strictEqual(transcript.sessionId, '11111111-2222-4333-8444-555555555555')
		assert.strictEqual(transcript.model, 'claude-sonnet-4-5')
		assert.strictEqual(transcript.cwd, '/home/sample/projects/mixtape')
		assert.strictEqual(transcript.startedAt, '2026-01-15T09:00:01.000Z')
		assert.strictEqual(transcript.title, 'Fix greeting')
		assert.strictEqual(transcript.titleSource, 'name')
	})

	it('skips meta and sidechain lines and merges assistant lines into turns', () => {
		assert.deepStrictEqual(
			transcript.turns.map((turn) => turn.role),
			['user', 'assistant'],
		)

		const text = JSON.stringify(transcript)
		assert.notInclude(text, 'Caveat:')
		assert.notInclude(text, 'SIDECHAIN')
	})

	it('pairs tool calls with results and builds an edit diff', () => {
		const [readTool, edit, bash] = tools(transcript)
		assert.strictEqual(readTool?.output, "export const greet = () => 'hi'\n")
		assert.strictEqual(edit?.output, 'The file has been updated.')
		assert.include(edit?.diff ?? '', "-export const greet = () => 'hi'")
		assert.include(edit?.diff ?? '', "+export const greet = () => 'hello world'")
		assert.isTrue(bash?.isError)
	})

	it('builds a resume command', () => {
		assert.strictEqual(
			claudeCodeSource.resumeCommand(transcript),
			'cd "/home/sample/projects/mixtape" && claude --resume 11111111-2222-4333-8444-555555555555',
		)
	})
})

describe('Codex source', () => {
	const transcript = parsed(codexSource, fixtures.codex)

	it('reads session metadata', () => {
		assert.strictEqual(transcript.sessionId, '019a0000-aaaa-7bbb-8ccc-dddddddddddd')
		assert.strictEqual(transcript.model, 'gpt-5-codex')
		assert.strictEqual(transcript.cwd, '/home/sample/projects/mixtape')
		assert.strictEqual(transcript.title, 'Change the greeting to hello world')
		assert.strictEqual(
			codexSource.resumeCommand(transcript),
			'codex resume 019a0000-aaaa-7bbb-8ccc-dddddddddddd',
		)
	})

	it('drops injected environment context', () => {
		assert.notInclude(JSON.stringify(transcript), 'environment_context')
		assert.deepStrictEqual(
			transcript.turns.map((turn) => turn.role),
			['user', 'assistant'],
		)
	})

	it('unwraps shell output and turns apply_patch into a diff', () => {
		const [shell, patch] = tools(transcript)
		assert.strictEqual(shell?.output, "print('hi')\n")
		assert.include(shell?.input ?? '', '"cat greet.py"')
		assert.include(patch?.diff ?? '', "+print('hello world')")
		assert.include(patch?.output ?? '', 'M greet.py')
	})
})

describe('Pi source', () => {
	const transcript = parsed(piSource, fixtures.pi)

	it('reads session metadata', () => {
		assert.strictEqual(transcript.sessionId, '33333333-4444-4555-8666-777777777777')
		assert.strictEqual(transcript.model, 'claude-sonnet-4-5')
		assert.strictEqual(transcript.cwd, '/home/sample/projects/mixtape')
		assert.strictEqual(transcript.title, 'Rename greet to welcome')
	})

	it('follows the active branch only', () => {
		const text = JSON.stringify(transcript)
		assert.notInclude(text, 'Abandoned branch answer')
		assert.include(text, 'Renaming now.')
		assert.include(text, 'Compaction summary')
	})

	it('uses the edit patch as the diff', () => {
		const [edit, bash] = tools(transcript)
		assert.include(edit?.diff ?? '', '+export const welcome = 1')
		assert.strictEqual(bash?.output, 'greet.ts\nREADME.md')
	})
})
