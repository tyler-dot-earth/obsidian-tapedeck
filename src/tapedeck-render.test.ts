import { readFileSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Result } from 'effect'

import { type RenderOptions, renderTranscriptNote } from '#/src/tapedeck-render'
import { claudeCodeSource } from '#/src/tapedeck-source-claude-code'

const transcript = Result.getOrThrow(
	claudeCodeSource.parse(
		readFileSync(
			'fixtures/claude-code/-home-sample-projects-demo/11111111-2222-4333-8444-555555555555.jsonl',
			'utf8',
		),
	),
)

const options: RenderOptions = {
	foldToolCalls: true,
	toolOutput: 'full',
	truncateLines: 1,
	includeThinking: false,
	noteStyle: 'raw',
	machine: 'sample-host',
	resume: claudeCodeSource.resumeCommand(transcript),
	importedAt: new Date('2026-02-01T12:00:00.000Z'),
	redactHome: '/home/sample',
	redactSecrets: true,
	previous: { created: undefined, project: undefined },
}

describe('renderTranscriptNote', () => {
	const note = renderTranscriptNote(transcript, options)

	it('writes the frontmatter', () => {
		assert.include(
			note,
			[
				'---',
				'type: transcript',
				'harness: claude-code',
				'model: "claude-sonnet-4-5"',
				'session_id: "11111111-2222-4333-8444-555555555555"',
				'machine: "sample-host"',
				'cwd: "~/projects/demo"',
				'resume: "cd \\"~/projects/demo\\" && claude --resume 11111111-2222-4333-8444-555555555555"',
				'date: 2026-01-15T09:00:01',
				'created: 2026-02-01T12:00:00',
				'project:',
				'---',
			].join('\n'),
		)
	})

	it('labels the note as a tape', () => {
		assert.include(note, '# 📼 Fix greeting')
	})

	it('folds tool calls into callouts with output and diff blocks', () => {
		assert.include(note, '> [!example]- tool: Edit')
		assert.include(note, '> ```diff')
		assert.include(note, '> [!failure]- tool: Bash (error)')
		assert.include(note, '> 1 failing\n> line 2\n> line 3')
	})

	it('redacts home paths and secrets', () => {
		assert.notInclude(note, '/home/sample')
		assert.notInclude(note, 'sk-ant-FAKE')
		assert.include(note, '[REDACTED]')
	})

	it('hides thinking unless asked', () => {
		assert.notInclude(note, 'Read the file first.')
		assert.include(
			renderTranscriptNote(transcript, { ...options, includeThinking: true }),
			'[!quote]- thinking',
		)
	})

	it('truncates or drops tool output', () => {
		const truncated = renderTranscriptNote(transcript, { ...options, toolOutput: 'truncated' })
		assert.include(truncated, '> … 2 more lines')

		const none = renderTranscriptNote(transcript, { ...options, toolOutput: 'none' })
		assert.notInclude(none, '1 failing')
	})

	it('expands callouts when folding is off', () => {
		assert.include(
			renderTranscriptNote(transcript, { ...options, foldToolCalls: false }),
			'> [!example]+ tool: Read',
		)
	})

	it('summarises tool calls in summary style', () => {
		const summary = renderTranscriptNote(transcript, { ...options, noteStyle: 'summary' })
		assert.notInclude(summary, '[!example]')
		assert.include(summary, '3 tool calls: Read, Edit, Bash')
	})

	it('keeps created and project from an earlier import', () => {
		const again = renderTranscriptNote(transcript, {
			...options,
			previous: { created: '2026-01-20T08:00:00', project: 'demo' },
		})

		assert.include(
			again,
			'created: 2026-01-20T08:00:00\nupdated: 2026-02-01T12:00:00\nproject: "demo"',
		)
	})

	it('picks a fence longer than any backtick run inside', () => {
		const tricky = {
			...transcript,
			turns: [
				{
					role: 'assistant' as const,
					timestamp: undefined,
					blocks: [
						{
							kind: 'tool' as const,
							name: 'Bash',
							input: '',
							diff: undefined,
							output: 'a ``` b',
							isError: false,
							images: [],
						},
					],
				},
			],
		}

		assert.include(renderTranscriptNote(tricky, options), '> ````text')
	})
})
