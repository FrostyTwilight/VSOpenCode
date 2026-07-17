import type { ServerInfo, SessionInfo, PathInfo } from '../types';
import { ServerService } from './ServerService';
import { SessionService } from './SessionService';
import { ConnectionMonitor } from './ConnectionMonitor';
import { normalizePath } from '../utils/path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds before idle shutdown countdown begins. */
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

/** Interval for polling agent busy status during idle countdown. */
const IDLE_CHECK_INTERVAL_MS = 10_000;

/** Interval for polling server workspace directory vs tracked project root. */
const WORKSPACE_CHECK_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// ServerController
// ---------------------------------------------------------------------------

/**
 * Singleton orchestrator that manages the full server lifecycle:
 *
 * - Owns {@link ServerService} (process lifecycle + health)
 * - Owns {@link SessionService} (REST API client, re-created on server start)
 * - Owns {@link ConnectionMonitor} (periodic health polling with edge-triggered events)
 * - Manages workspace mismatch detection via periodic `GET /path` polling
 * - Manages idle shutdown (5-min timer → 10s busy-polls → `stop()`)
 *
 * ## Usage
 *
 * ```ts
 * const ctrl = getServerController();
 * ctrl.onConnectionLost = () => vscode.window.showWarningMessage('Server disconnected');
 * ctrl.onWorkspaceMismatch = () => vscode.window.showWarningMessage('Workspace changed');
 *
 * const { sessionUrl } = await ctrl.start('/path/to/project');
 * // ... use sessionUrl ...
 * await ctrl.stop();
 * ```
 */
export class ServerController {
	// -----------------------------------------------------------------------
	// Owned services
	// -----------------------------------------------------------------------

	private readonly _serverService: ServerService;
	private _sessionService: SessionService | null = null;
	private _connectionMonitor: ConnectionMonitor | null = null;

	// -----------------------------------------------------------------------
	// Tracked state
	// -----------------------------------------------------------------------

	private _projectRoot = '';
	private _sessionId = '';
	private _baseUrl = '';

	// -----------------------------------------------------------------------
	// Timers
	// -----------------------------------------------------------------------

	private _workspaceCheckInterval: ReturnType<typeof setInterval> | null =
		null;
	private _idleTimeout: ReturnType<typeof setTimeout> | null = null;
	private _idleCheckInterval: ReturnType<typeof setInterval> | null = null;

	// -----------------------------------------------------------------------
	// Public callbacks / events
	// -----------------------------------------------------------------------

	/** Fired when the connection monitor detects a healthy → unhealthy transition. */
	onConnectionLost: (() => void) | null = null;

	/** Fired when the connection monitor detects an unhealthy → healthy transition. */
	onConnectionRestored: (() => void) | null = null;

	/** Fired when `GET /path` reports a directory that differs from the tracked project root. */
	onWorkspaceMismatch: (() => void) | null = null;

	// -----------------------------------------------------------------------
	// Construction
	// -----------------------------------------------------------------------

	constructor() {
		this._serverService = new ServerService();
	}

	// -----------------------------------------------------------------------
	// start
	// -----------------------------------------------------------------------

	/**
	 * Ensure the server is running, find or create a session, wire up
	 * monitoring, and return the session URL.
	 *
	 * @param projectRoot - Absolute path to the project working directory.
	 * @returns The session URL (e.g. `http://127.0.0.1:4096/session/{id}`).
	 */
	async start(projectRoot: string): Promise<{ sessionUrl: string }> {
		// 1. Cancel any pending idle shutdown
		this._cancelIdleShutdown();

		// 2. Ensure server is running (reuse if healthy, otherwise start)
		const healthy = await this._serverService.checkHealth();
		if (!healthy) {
			const serverInfo: ServerInfo =
				await this._serverService.start(projectRoot);
			this._baseUrl = serverInfo.baseUrl;
		} else {
			const { baseUrl } = this._serverService.getClient();
			this._baseUrl = baseUrl;
		}

		// 3. Create / update SessionService with current base URL
		this._sessionService = new SessionService(this._baseUrl);

		// 4. Find existing session or create a new one
		const normalizedRoot = normalizePath(projectRoot);
		const sessions =
			await this._sessionService.listSessions(projectRoot);
		const existing = sessions.find(
			(s) =>
				s.directory &&
				normalizePath(s.directory) === normalizedRoot,
		);

		let session: SessionInfo;
		if (existing) {
			session = existing;
		} else {
			session = await this._sessionService.createSession(
				projectRoot,
				'VS Code OpenCode',
			);
		}

		this._sessionId = session.id;
		this._projectRoot = normalizedRoot;

		// 5. Create (or recreate) ConnectionMonitor
		if (this._connectionMonitor) {
			this._connectionMonitor.dispose();
		}
		this._connectionMonitor = new ConnectionMonitor(() =>
			this._serverService.checkHealth(),
		);
		this._connectionMonitor.onConnectionLost = () => {
			this.onConnectionLost?.();
		};
		this._connectionMonitor.onConnectionRestored = () => {
			this.onConnectionRestored?.();
		};
		this._connectionMonitor.start();

		// 6. Start workspace mismatch detection
		this._startWorkspaceCheck();

		// 7. Schedule idle shutdown
		this._scheduleIdleShutdown();

		return { sessionUrl: this.getSessionUrl() };
	}

	// -----------------------------------------------------------------------
	// getSessionUrl
	// -----------------------------------------------------------------------

	/**
	 * Return the full session URL for the current session.
	 *
	 * @throws If the server hasn't been started yet.
	 */
	getSessionUrl(): string {
		if (!this._baseUrl || !this._sessionId) {
			throw new Error(
				'Server not started. Call start() before getSessionUrl().',
			);
		}
		return `${this._baseUrl}/session/${this._sessionId}`;
	}

	// -----------------------------------------------------------------------
	// stop
	// -----------------------------------------------------------------------

	/**
	 * Stop all monitoring, tear down the session, and kill the server process.
	 */
	async stop(): Promise<void> {
		this._cancelIdleShutdown();
		this._stopWorkspaceCheck();

		if (this._connectionMonitor) {
			this._connectionMonitor.dispose();
			this._connectionMonitor = null;
		}

		this._sessionService = null;
		this._sessionId = '';

		await this._serverService.stop();
	}

	// -----------------------------------------------------------------------
	// isAgentBusy
	// -----------------------------------------------------------------------

	/**
	 * Query `GET /session/{id}/status` and check whether the agent is
	 * currently busy (i.e. the `status` field contains "busy" or "working").
	 *
	 * @returns `true` if the agent reports a busy status, `false` otherwise
	 * (including when the server is unreachable or the endpoint is unknown).
	 */
	async isAgentBusy(): Promise<boolean> {
		if (!this._baseUrl || !this._sessionId) {
			return false;
		}

		try {
			const response = await fetch(
				`${this._baseUrl}/session/${this._sessionId}/status`,
				{ signal: AbortSignal.timeout(5_000) },
			);
			if (!response.ok) {
				return false;
			}
			const data: unknown = await response.json();
			if (
				typeof data === 'object' &&
				data !== null &&
				'status' in data
			) {
				const status = String(
					(data as { status: unknown }).status,
				).toLowerCase();
				return (
					status.includes('busy') ||
					status.includes('working')
				);
			}
			return false;
		} catch {
			return false;
		}
	}

	// -----------------------------------------------------------------------
	// updateProjectRoot
	// -----------------------------------------------------------------------

	/**
	 * Update the tracked project root, restart workspace checking, and
	 * reschedule the idle shutdown timer.
	 *
	 * Does **not** restart the server or create a new session — callers
	 * should invoke {@link start} again if a new session is required.
	 */
	updateProjectRoot(newRoot: string): void {
		this._projectRoot = normalizePath(newRoot);
		this._startWorkspaceCheck();
		this._scheduleIdleShutdown();
	}

	// -----------------------------------------------------------------------
	// Private — workspace check
	// -----------------------------------------------------------------------

	/**
	 * Start a repeating interval that polls `GET /path` and compares the
	 * server-reported directory to the tracked project root.  If they
	 * differ, {@link onWorkspaceMismatch} is fired.
	 */
	private _startWorkspaceCheck(): void {
		this._stopWorkspaceCheck();

		this._workspaceCheckInterval = setInterval(async () => {
			try {
				if (!this._sessionService) {
					return;
				}
				const pathInfo: PathInfo =
					await this._sessionService.getServerPath();
				const serverDir = pathInfo.directory;
				if (
					serverDir &&
					normalizePath(serverDir) !== this._projectRoot
				) {
					this.onWorkspaceMismatch?.();
				}
			} catch {
				// Silently ignore — server may be temporarily unreachable
			}
		}, WORKSPACE_CHECK_INTERVAL_MS);
	}

	private _stopWorkspaceCheck(): void {
		if (this._workspaceCheckInterval !== null) {
			clearInterval(this._workspaceCheckInterval);
			this._workspaceCheckInterval = null;
		}
	}

	// -----------------------------------------------------------------------
	// Private — idle shutdown
	// -----------------------------------------------------------------------

	/**
	 * Schedule an idle shutdown: after a 5-minute countdown, start polling
	 * {@link isAgentBusy} every 10 seconds.  When the agent is no longer
	 * busy, call {@link stop}.
	 *
	 * Safe to call repeatedly — previous timers are cleared first.
	 */
	private _scheduleIdleShutdown(): void {
		this._cancelIdleShutdown();

		this._idleTimeout = setTimeout(() => {
			this._idleCheckInterval = setInterval(async () => {
				try {
					const busy = await this.isAgentBusy();
					if (!busy) {
						await this.stop();
					}
				} catch {
					// If we can't check, keep waiting
				}
			}, IDLE_CHECK_INTERVAL_MS);
		}, IDLE_SHUTDOWN_MS);
	}

	/** Clear both the idle timeout and the busy-check interval. */
	private _cancelIdleShutdown(): void {
		if (this._idleTimeout !== null) {
			clearTimeout(this._idleTimeout);
			this._idleTimeout = null;
		}
		if (this._idleCheckInterval !== null) {
			clearInterval(this._idleCheckInterval);
			this._idleCheckInterval = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let instance: ServerController | null = null;

/**
 * Return the module-level {@link ServerController} singleton, creating it
 * on first access.
 */
export function getServerController(): ServerController {
	if (!instance) {
		instance = new ServerController();
	}
	return instance;
}
