import type { Disposable } from 'vscode';

/**
 * Monitors server health via periodic polling with edge-triggered callbacks.
 *
 * Fires {@link onConnectionLost} and {@link onConnectionRestored} only on
 * **health state transitions**, not on every poll. The first poll establishes
 * the baseline without firing events.
 *
 * @example
 * ```typescript
 * const monitor = new ConnectionMonitor(async () => {
 *   const res = await fetch(`${baseUrl}/global/health`);
 *   const json = (await res.json()) as HealthInfo;
 *   return json.healthy;
 * }, 5000);
 *
 * monitor.onConnectionLost = () => showWarning('Server disconnected');
 * monitor.onConnectionRestored = () => showInfo('Server reconnected');
 *
 * monitor.start();
 * // later: monitor.dispose();
 * ```
 */
export class ConnectionMonitor implements Disposable {
	private readonly _checkHealth: () => Promise<boolean>;
	private readonly _intervalMs: number;
	private _interval: ReturnType<typeof setInterval> | null = null;
	private _isHealthy = false;
	private _wasConnected = false;
	private _initialized = false;

	/** Fired when health transitions from healthy → unhealthy. */
	onConnectionLost: (() => void) | null = null;

	/** Fired when health transitions from unhealthy → healthy. */
	onConnectionRestored: (() => void) | null = null;

	/**
	 * @param checkHealth — Async function that returns `true` when the
	 * server is healthy.
	 * @param intervalMs — Polling interval in milliseconds (default 5000).
	 */
	constructor(
		checkHealth: () => Promise<boolean>,
		intervalMs: number = 5000,
	) {
		this._checkHealth = checkHealth;
		this._intervalMs = intervalMs;
	}

	/** Whether the most recent health check passed. */
	get isHealthy(): boolean {
		return this._isHealthy;
	}

	/**
	 * Start periodic health checks. Runs an immediate first poll, then
	 * repeats on the configured interval. Idempotent — safe to call
	 * after already started.
	 */
	start(): void {
		if (this._interval !== null) {
			return;
		}
		// First poll runs immediately, then every intervalMs.
		void this._poll();
		this._interval = setInterval(() => {
			void this._poll();
		}, this._intervalMs);
	}

	/**
	 * Stop periodic health checks. Idempotent — safe to call multiple
	 * times or when already stopped.
	 */
	stop(): void {
		if (this._interval === null) {
			return;
		}
		clearInterval(this._interval);
		this._interval = null;
	}

	/** Dispose the monitor, stopping all polling. Implements `vscode.Disposable`. */
	dispose(): void {
		this.stop();
	}

	// ------------------------------------------------------------------
	// Internal
	// ------------------------------------------------------------------

	private async _poll(): Promise<void> {
		try {
			const healthy = await this._checkHealth();
			this._handleResult(healthy);
		} catch {
			// Health check threw (network error, etc.) — treat as unhealthy.
			this._handleResult(false);
		}
	}

	private _handleResult(healthy: boolean): void {
		if (this._initialized) {
			// Edge detection: fire callbacks only on state transitions.
			if (healthy && !this._wasConnected) {
				this.onConnectionRestored?.();
			} else if (!healthy && this._wasConnected) {
				this.onConnectionLost?.();
			}
		}

		this._isHealthy = healthy;
		this._wasConnected = healthy;
		this._initialized = true;
	}
}
