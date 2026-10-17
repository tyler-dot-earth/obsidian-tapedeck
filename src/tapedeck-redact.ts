const redacted = '[REDACTED]'

/** Token shapes that are almost never prose. */
const secretPatterns: ReadonlyArray<RegExp> = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{30,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{22,}/g,
	/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bAIza[0-9A-Za-z_-]{35}\b/g,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]

/** `api_key = value`, `"token": "value"`, `Authorization: Bearer value`. Keeps the key. */
const assignmentPattern =
	/\b((?:api[_-]?key|secret|token|password|passwd|access[_-]?key|auth[_-]?token)["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi

const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g

/** Replaces common API key and token shapes with `[REDACTED]`. */
export const redactSecrets = (text: string): string => {
	const masked = secretPatterns.reduce(
		(current, pattern) => current.replace(pattern, redacted),
		text,
	)

	return masked.replace(assignmentPattern, `$1${redacted}`).replace(bearerPattern, `$1${redacted}`)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rewrites the home directory to `~`, in native and forward-slash spellings. */
export const redactHomePaths = (text: string, home: string): string => {
	const trimmed = home.replace(/[\\/]+$/, '')

	if (trimmed.length < 2) {
		return text
	}

	const spellings = [...new Set([trimmed, trimmed.replaceAll('\\', '/')])]

	const pattern = new RegExp(
		`${spellings.map(escapeRegExp).join('|')}(?=$|[\\\\/"'\\s:)\\]}>,])`,
		'g',
	)

	return text.replace(pattern, '~')
}
