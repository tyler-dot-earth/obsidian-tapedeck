/**
 * Tapedeck notes by session key, updated one note at a time. Files are tracked by identity, so a
 * renamed note stays indexed without a rebuild.
 */
export class NoteIndex<F> {
	private readonly byKey = new Map<string, F>()
	private readonly keyOf = new Map<F, string>()

	get(key: string): F | undefined {
		return this.byKey.get(key)
	}

	has(file: F): boolean {
		return this.keyOf.has(file)
	}

	/**
	 * Records a note's session key, or forgets the note when `key` is undefined (it is no longer a
	 * transcript). Returns whether the index changed.
	 */
	set(file: F, key: string | undefined): boolean {
		const previous = this.keyOf.get(file)

		if (previous === key) {
			return false
		}

		if (previous !== undefined) {
			this.drop(file, previous)
		}

		if (key !== undefined) {
			this.byKey.set(key, file)
			this.keyOf.set(file, key)
		}

		return true
	}

	/** Forgets a deleted note. Returns whether it was indexed. */
	remove(file: F): boolean {
		const previous = this.keyOf.get(file)

		if (previous === undefined) {
			return false
		}

		this.drop(file, previous)

		return true
	}

	private drop(file: F, key: string): void {
		this.keyOf.delete(file)

		if (this.byKey.get(key) === file) {
			this.byKey.delete(key)
		}
	}
}

/** A plain change signal: listeners run on `trigger`, and `on` hands back the unsubscribe. */
export class ChangeSignal {
	private readonly listeners = new Set<() => void>()

	on(listener: () => void): () => void {
		this.listeners.add(listener)

		return (): void => {
			this.listeners.delete(listener)
		}
	}

	trigger(): void {
		for (const listener of this.listeners) {
			listener()
		}
	}
}
