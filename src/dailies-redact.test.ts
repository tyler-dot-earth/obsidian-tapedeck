import { assert, describe, it } from '@effect/vitest'

import { redactHomePaths, redactSecrets } from '#/src/dailies-redact'

describe('redactSecrets', () => {
	it('masks common token shapes', () => {
		const samples = [
			'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
			'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
			'AKIAABCDEFGHIJKLMNOP',
			'xoxb-123456789012-abcdefghij',
			'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
		]

		for (const sample of samples) {
			assert.include(redactSecrets(sample), '[REDACTED]', sample)
		}
	})

	it('keeps the key name in assignments', () => {
		assert.strictEqual(redactSecrets('API_KEY=abcd1234efgh5678'), 'API_KEY=[REDACTED]')
		assert.strictEqual(redactSecrets('"token": "abcd1234efgh5678"'), '"token": "[REDACTED]"')
	})

	it('leaves prose alone', () => {
		const prose = 'The token budget is fine and the secret sauce is tests.'
		assert.strictEqual(redactSecrets(prose), prose)
	})
})

describe('redactHomePaths', () => {
	it('rewrites the home directory', () => {
		assert.strictEqual(redactHomePaths('/home/sample/projects/x', '/home/sample'), '~/projects/x')
		assert.strictEqual(redactHomePaths('cd /home/sample', '/home/sample/'), 'cd ~')
	})

	it('does not touch longer names that share a prefix', () => {
		assert.strictEqual(redactHomePaths('/home/samplex/a', '/home/sample'), '/home/samplex/a')
	})

	it('handles Windows homes in both slash styles', () => {
		const home = 'C:\\Users\\sample'
		assert.strictEqual(
			redactHomePaths('C:\\Users\\sample\\repo and C:/Users/sample/repo', home),
			'~\\repo and ~/repo',
		)
	})
})
