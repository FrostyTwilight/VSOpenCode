import * as cp from "child_process";
import type { ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ProcessRegistry } from "../utils/process";
import type { ConnectionState, ServerInfo } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex for parsing `opencode server listening on http://host:port` from stdout. */
const LISTENING_PATTERN = /opencode server listening on http:\/\/(.+):(\d+)/;

/** Default host when the server doesn't report one. */
const DEFAULT_HOST = "127.0.0.1";

/** Default port when the server doesn't report one. */
const DEFAULT_PORT = 4096;

/** Interval between health-check polls (ms). */
const HEALTH_POLL_INTERVAL_MS = 500;

/** Maximum time to wait for the server to start and report its listening URL. */
const STARTUP_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked whenever `ConnectionState` changes. */
export type StateChangeListener = (state: ConnectionState) => void;

// ---------------------------------------------------------------------------
// ServerService
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of a local `opencode serve` process.
 *
 * ## Usage
 *
 * ```ts
 * const svc = new ServerService();
 * svc.onStateChange = (state) => console.log("State:", state);
 * await svc.start("/path/to/project");
 * const { baseUrl } = svc.getClient();
 * // ... use baseUrl ...
 * await svc.stop();
 * ```
 */
export class ServerService {
	// -----------------------------------------------------------------------
	// Public callback
	// -----------------------------------------------------------------------

	/** Set this to receive state-change notifications. */
	public onStateChange: StateChangeListener | undefined;

	// -----------------------------------------------------------------------
	// Private state
	// -----------------------------------------------------------------------

	private _state: ConnectionState = "disconnected";
	private _serverInfo: ServerInfo | null = null;
	private _process: ChildProcess | null = null;
	/** True when `stop()` is in progress — suppresses crash→error transitions. */
	private _stopping = false;

	// -----------------------------------------------------------------------
	// State management
	// -----------------------------------------------------------------------

	/** Current connection state. */
	public get state(): ConnectionState {
		return this._state;
	}

	/**
	 * Transition to a new state.  If the state actually changes, the
	 * {@link onStateChange} callback is fired synchronously.
	 */
	private _setState(newState: ConnectionState): void {
		if (this._state === newState) {
			return;
		}
		this._state = newState;
		this.onStateChange?.(newState);
	}

	// -----------------------------------------------------------------------
	// resolveOpenCodePath
	// -----------------------------------------------------------------------

	/**
	 * Resolve the full path to the `opencode` executable.
	 *
	 * Resolution order:
	 * 1. VS Code config `vscode-opencode.opencodePath`
	 * 2. `where` (Windows) / `which` (macOS/Linux)
	 * 3. Platform-specific fallback directories
	 *
	 * @throws If no executable can be found.
	 */
	public resolveOpenCodePath(): string {
		// 1. Check VS Code workspace configuration
		const configured = vscode.workspace
			.getConfiguration("vscode-opencode")
			.get<string>("opencodePath");
		if (configured && configured.trim().length > 0) {
			return this._resolveCmdToExe(configured.trim());
		}

		// 2. Shell lookup via where / which
		const shellPath = this._shellLookup();
		if (shellPath) {
			return this._resolveCmdToExe(shellPath);
		}

		// 3. Platform fallback paths
		const fallbackPath = this._findFallbackPath();
		if (fallbackPath) {
			return this._resolveCmdToExe(fallbackPath);
		}

		throw new Error(
			"Could not locate the opencode executable. " +
				"Set 'vscode-opencode.opencodePath' in your VS Code settings, " +
				"or ensure opencode is on your PATH.",
		);
	}

	/**
	 * On Windows, if `resolvedPath` is a `.cmd` wrapper script, resolve it to
	 * the underlying `.exe` so we can spawn it directly without `cmd.exe /c`
	 * (which pops a console window).
	 */
	private _resolveCmdToExe(resolvedPath: string): string {
		if (process.platform !== "win32" || !resolvedPath.endsWith(".cmd")) {
			return resolvedPath;
		}
		const exePath = this._resolveExeFromCmd(resolvedPath);
		if (exePath) {
			console.log(`[OpenCode] Resolved .cmd wrapper to: ${exePath}`);
			return exePath;
		}
		console.log(
			`[OpenCode] Could not parse .cmd file, falling back to: ${resolvedPath}`,
		);
		return resolvedPath;
	}

	/**
	 * Run `where opencode` (Windows) or `which opencode` (Unix).
	 * Returns the first match or `null`.
	 */
	private _shellLookup(): string | null {
		const isWin = process.platform === "win32";
		const cmd = isWin ? "where" : "which";
		try {
			const result = cp.execSync(`${cmd} opencode`, {
				encoding: "utf-8",
				timeout: 5_000,
			});
			const lines = result.trim().split(/\r?\n/);

			if (isWin) {
				// On Windows, `where` may return paths without extensions.
				// child_process.spawn() cannot execute files without
				// extensions on Windows, so prefer matches that already
				// have a recognized extension.
				const extPattern = /\.(cmd|exe|bat)$/i;
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed && extPattern.test(trimmed)) {
						return trimmed;
					}
				}
				// No match with extension — try appending .cmd to the
				// first result as a last resort.
				const first = lines[0]?.trim();
				if (first && first.length > 0) {
					return `${first}.cmd`;
				}
				return null;
			}

			const first = lines[0]?.trim();
			return first && first.length > 0 ? first : null;
		} catch {
			return null;
		}
	}

	/**
	 * Walk through platform-specific candidate paths and return the first
	 * one that exists on disk.
	 */
	private _findFallbackPath(): string | null {
		if (process.platform === "win32") {
			return this._findFallbackPathWindows();
		}
		return this._findFallbackPathUnix();
	}

	/** Windows fallback candidate paths. */
	private _findFallbackPathWindows(): string | null {
		const candidates: string[] = [];

		const appData = process.env.APPDATA;
		if (appData) {
			candidates.push(path.join(appData, "npm", "opencode.cmd"));
		}

		const localAppData = process.env.LOCALAPPDATA;
		if (localAppData) {
			candidates.push(
				path.join(localAppData, "nvmw", "nodejs", "opencode.cmd"),
			);
		}

		const progFiles = process.env.ProgramFiles;
		if (progFiles) {
			candidates.push(path.join(progFiles, "nodejs", "opencode.cmd"));
		}

		return this._firstExisting(candidates);
	}

	/** macOS / Linux fallback candidate paths. */
	private _findFallbackPathUnix(): string | null {
		const candidates: string[] = [
			"/usr/local/bin/opencode",
		];

		const home = os.homedir();
		if (home) {
			candidates.push(path.join(home, ".npm-global", "bin", "opencode"));

			// nvm — check $NVM_DIR first, then ~/.nvm
			const nvmDir = process.env.NVM_DIR ?? path.join(home, ".nvm");
			const versionsDir = path.join(nvmDir, "versions", "node");
			try {
				const entries = fs.readdirSync(versionsDir, {
					withFileTypes: true,
				});
				for (const entry of entries) {
					if (entry.isDirectory()) {
						candidates.push(
							path.join(versionsDir, entry.name, "bin", "opencode"),
						);
					}
				}
			} catch {
				// nvm directory doesn't exist — skip
			}
		}

		return this._firstExisting(candidates);
	}

	/** Return the first candidate that exists on disk, or `null`. */
	private _firstExisting(candidates: string[]): string | null {
		for (const p of candidates) {
			try {
				if (fs.existsSync(p)) {
					return p;
				}
			} catch {
				// permission error — skip
			}
		}
		return null;
	}

	/**
	 * Parse a `.cmd` wrapper script to find the underlying `.exe` path.
	 *
	 * Typical npm global `.cmd` files contain a line like:
	 * ```
	 * "%dp0%\node_modules\opencode-ai\bin\opencode.exe"   %*
	 * ```
	 * where `dp0` is the directory containing the `.cmd` file.
	 *
	 * @returns The resolved `.exe` path, or `null` if it couldn't be found.
	 */
	private _resolveExeFromCmd(cmdPath: string): string | null {
		try {
			const fd = fs.openSync(cmdPath, "r");
			const buf = Buffer.alloc(500);
			const bytesRead = fs.readSync(fd, buf, 0, 500, 0);
			fs.closeSync(fd);

			const content = buf.toString("utf-8", 0, bytesRead);
			const lines = content.split(/\r?\n/);

			const pattern = /"%dp0%[\\/](.+?)"/;
			for (const line of lines) {
				const match = pattern.exec(line);
				if (match) {
					const relativePath = match[1]!;
					const resolved = path.join(path.dirname(cmdPath), relativePath);
					if (fs.existsSync(resolved)) {
						return resolved;
					}
				}
			}

			return null;
		} catch {
			return null;
		}
	}

	// -----------------------------------------------------------------------
	// start
	// -----------------------------------------------------------------------

	/**
	 * Spawn `opencode serve` for the given project root.
	 *
	 * If a process is already running it is stopped first.
	 *
	 * @param projectRoot Absolute path to the project working directory.
	 * @returns The {@link ServerInfo} for the running server.
	 * @throws If the process fails to start or times out.
	 */
	public async start(projectRoot: string): Promise<ServerInfo> {
		// Stop any existing process
		if (this._process) {
			await this.stop();
		}

		this._stopping = false;
		this._setState("connecting");

		let opencodePath = this.resolveOpenCodePath();

		// Hex dump each character to help diagnose hidden/unprintable chars
		const hexDump = [...opencodePath]
			.map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
			.join(" ");
		console.log(`[OpenCode] Resolved binary: ${opencodePath}`);
		console.log(`[OpenCode] Resolved binary hex: ${hexDump}`);

		// Validate the resolved path exists on disk
		if (!fs.existsSync(opencodePath)) {
			// On Windows with no extension, try .cmd as final fallback
			if (process.platform === "win32" && !path.extname(opencodePath)) {
				const withCmd = `${opencodePath}.cmd`;
				console.log(`[OpenCode] Path not found, trying .cmd fallback: ${withCmd}`);
				if (fs.existsSync(withCmd)) {
					console.log(`[OpenCode] Using .cmd fallback: ${withCmd}`);
					opencodePath = withCmd;
				}
			}
		}

		if (!fs.existsSync(opencodePath)) {
			throw new Error(
				`OpenCode executable not found at: ${opencodePath}. ` +
					"Set 'vscode-opencode.opencodePath' in your VS Code settings, " +
					"or ensure opencode is on your PATH.",
			);
		}

		console.log(`[OpenCode] Spawning: ${opencodePath} serve (cwd: ${projectRoot})`);

		const spawnOpts: cp.SpawnOptions = {
			cwd: projectRoot,
			detached: true,
			stdio: "pipe",
			windowsHide: true,
		};

		let proc: ChildProcess;
		try {
			proc = cp.spawn(opencodePath, ["serve"], spawnOpts);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[OpenCode] spawn failed: ${msg}`);
			console.error(`[OpenCode] spawn path: ${opencodePath}`);
			console.error(`[OpenCode] spawn path hex: ${hexDump}`);
			throw new Error(
				`Failed to spawn opencode process: ${msg}. ` +
					`Path: ${opencodePath}. ` +
					"Verify that the path points to a valid executable.",
			);
		}

		this._process = proc;
		ProcessRegistry.register(proc);
		console.log(`[OpenCode] Process spawned, PID: ${proc.pid}`);

		// Listen for unexpected exit
		proc.on("exit", (code, signal) => {
			console.log(`[OpenCode] Process exited: code=${code}, signal=${signal}`);
			this._process = null;
			if (!this._stopping && this._state !== "disconnected") {
				this._setState("error");
			}
		});

		// Listen for stderr (log it for debugging)
		proc.stderr?.on("data", (chunk: Buffer) => {
			console.error(`[OpenCode] stderr: ${chunk.toString().trim()}`);
		});

		// Listen for stdout (raw)
		proc.stdout?.on("data", (chunk: Buffer) => {
			console.log(`[OpenCode] stdout: ${chunk.toString().trim()}`);
		});

		// Wait for the server to print its listening URL
		const serverInfo = await this._waitForListeningUrl(proc);
		this._serverInfo = serverInfo;

		// Wait for the health endpoint to respond
		const healthy = await this.waitForHealth(STARTUP_TIMEOUT_MS);
		if (!healthy) {
			// Server is not responding — clean up
			this._stopping = true;
			if (this._process) {
				this._stopProcess();
			}
			this._setState("error");
			throw new Error(
				"OpenCode server started but health check failed within the timeout.",
			);
		}

		this._setState("connected");
		return serverInfo;
	}

	/**
	 * Read stdout line-by-line until the listening URL pattern is matched
	 * or the timeout expires.
	 */
	private _waitForListeningUrl(proc: ChildProcess): Promise<ServerInfo> {
		return new Promise<ServerInfo>((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup();
				reject(
					new Error(
						"Timed out waiting for opencode server to report its listening URL.",
					),
				);
			}, STARTUP_TIMEOUT_MS);

			let buffer = "";

			const onData = (chunk: Buffer) => {
				buffer += chunk.toString("utf-8");
				const lines = buffer.split(/\r?\n/);
				// Keep the last partial line in the buffer
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const match = LISTENING_PATTERN.exec(line);
					if (match) {
						const host = match[1] ?? DEFAULT_HOST;
						const port = parseInt(match[2] ?? String(DEFAULT_PORT), 10);
						cleanup();
						const baseUrl = `http://${host}:${port}`;
						resolve({
							host,
							port,
							baseUrl,
						} as ServerInfo);
						return;
					}
				}
			};

			const onExit = () => {
				cleanup();
				reject(
					new Error("OpenCode server process exited before reporting its listening URL."),
				);
			};

			const cleanup = () => {
				clearTimeout(timeout);
				proc.stdout?.off("data", onData);
				proc.off("exit", onExit);
			};

			proc.stdout?.on("data", onData);
			proc.once("exit", onExit);
		});
	}

	// -----------------------------------------------------------------------
	// checkHealth
	// -----------------------------------------------------------------------

	/**
	 * Call the server health endpoint once.
	 *
	 * @returns `true` if the server reports `healthy: true`, `false` otherwise.
	 */
	public async checkHealth(): Promise<boolean> {
		if (!this._serverInfo) {
			return false;
		}

		try {
			const response = await fetch(
				`${this._serverInfo.baseUrl}/global/health`,
				{ signal: AbortSignal.timeout(5_000) },
			);
			if (!response.ok) {
				return false;
			}
			const body: unknown = await response.json();
			if (
				typeof body === "object" &&
				body !== null &&
				"healthy" in body
			) {
				return (body as { healthy: boolean }).healthy === true;
			}
			return false;
		} catch {
			return false;
		}
	}

	// -----------------------------------------------------------------------
	// waitForHealth
	// -----------------------------------------------------------------------

	/**
	 * Poll {@link checkHealth} every 500 ms until the server responds or
	 * `timeoutMs` elapses.
	 *
	 * @param timeoutMs Maximum time to wait in milliseconds.
	 * @returns `true` if the server becomes healthy, `false` on timeout.
	 */
	public async waitForHealth(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const healthy = await this.checkHealth();
			if (healthy) {
				return true;
			}
			await this._delay(HEALTH_POLL_INTERVAL_MS);
		}

		return false;
	}

	/** Promise-based delay helper. */
	private _delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// -----------------------------------------------------------------------
	// stop
	// -----------------------------------------------------------------------

	/**
	 * Kill the managed server process and transition to `"disconnected"`.
	 */
	public async stop(): Promise<void> {
		this._stopping = true;

		this._stopProcess();

		this._serverInfo = null;
		this._stopping = false;
		this._setState("disconnected");
	}

	/** Kill the spawned process via {@link ProcessRegistry}. */
	private _stopProcess(): void {
		const proc = this._process;
		if (!proc || proc.pid === undefined) {
			this._process = null;
			return;
		}

		// Detach the exit listener so the crash→error transition doesn't fire
		proc.removeAllListeners("exit");
		ProcessRegistry.kill(proc.pid);
		this._process = null;
	}

	// -----------------------------------------------------------------------
	// getClient
	// -----------------------------------------------------------------------

	/**
	 * Return the current server's base URL.
	 *
	 * @throws If the server hasn't been started yet.
	 */
	public getClient(): { baseUrl: string } {
		if (!this._serverInfo) {
			throw new Error(
				"Server is not running. Call start() before getClient().",
			);
		}
		return { baseUrl: this._serverInfo.baseUrl };
	}
}
