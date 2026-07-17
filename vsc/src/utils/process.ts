import { spawnSync } from 'child_process';
import type { ChildProcess } from 'child_process';

/**
 * Thread-safe registry of spawned child processes.
 *
 * Automatically removes entries when the process emits `'exit'`, so
 * callers don't need to manually unregister.
 *
 * ## Platform-aware kill
 *
 * | Platform          | Mechanism                                                                 |
 * |-------------------|---------------------------------------------------------------------------|
 * | **Windows**       | `taskkill /pid <pid> /f /t` — force-kills the process tree.              |
 * | **macOS / Linux** | `process.kill(-pid, 'SIGTERM')` — signals the process **group**.         |
 *
 * > **Important:** The process-group kill on Unix requires the child to be
 * > spawned with `{ detached: true }` (or the child calls `setsid()`) so
 * > it becomes a group leader.  Without this, the negative pid has no effect.
 */
export class ProcessRegistry {
	private static readonly _registry = new Map<number, ChildProcess>();

	/**
	 * Register a child process.  Its pid is tracked and a one-shot `'exit'`
	 * listener will auto-remove the entry when the process terminates.
	 */
	static register(proc: ChildProcess): void {
		const pid = proc.pid;
		if (pid === undefined) {
			return; // process hasn't spawned yet — nothing to track
		}
		this._registry.set(pid, proc);
		proc.on('exit', () => {
			this._registry.delete(pid);
		});
	}

	/**
	 * Kill a specific process by pid.
	 *
	 * On Windows this invokes `taskkill`; on Unix it sends `SIGTERM` to
	 * the process group (negative pid).
	 *
	 * @returns `true` if the kill was attempted, `false` if the signal
	 *          failed (Unix only — `taskkill` is always attempted).
	 */
	static kill(pid: number): boolean {
		if (process.platform === 'win32') {
			spawnSync('taskkill', ['/pid', String(pid), '/f', '/t']);
			return true;
		}

		try {
			process.kill(-pid, 'SIGTERM');
			return true;
		} catch {
			return false;
		}
	}

	/** Kill every registered process and clear the registry. */
	static killAll(): void {
		for (const pid of this._registry.keys()) {
			this.kill(pid);
		}
		this._registry.clear();
	}
}
