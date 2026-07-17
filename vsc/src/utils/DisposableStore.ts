import type { Disposable } from 'vscode';

/**
 * Aggregates multiple {@link Disposable} instances and disposes them in
 * **reverse order** (LIFO) when its own `dispose()` is called.
 *
 * Implements `vscode.Disposable` so it can be added to VS Code extension
 * subscriptions and nested inside other `DisposableStore` instances.
 */
export class DisposableStore implements Disposable {
	private readonly _disposables: Disposable[] = [];

	/** Register a disposable to be disposed later. */
	add(disposable: Disposable): void {
		this._disposables.push(disposable);
	}

	/**
	 * Dispose all registered disposables in reverse order and clear the
	 * store. Safe to call multiple times.
	 */
	dispose(): void {
		this.disposeAll();
	}

	/** Same as dispose() — disposes all registrations in LIFO order. */
	disposeAll(): void {
		while (this._disposables.length > 0) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	/**
	 * Convenience factory that creates a `DisposableStore` pre-populated
	 * with the given disposables.
	 */
	static from(...disposables: Disposable[]): DisposableStore {
		const store = new DisposableStore();
		for (const d of disposables) {
			store.add(d);
		}
		return store;
	}
}
