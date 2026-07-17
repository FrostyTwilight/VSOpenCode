"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode7 = require("vscode");

// src/ExtensionController.ts
var vscode6 = __toESM(require("vscode"));

// src/utils/DisposableStore.ts
var DisposableStore = class _DisposableStore {
  _disposables = [];
  /** Register a disposable to be disposed later. */
  add(disposable) {
    this._disposables.push(disposable);
  }
  /**
   * Dispose all registered disposables in reverse order and clear the
   * store. Safe to call multiple times.
   */
  dispose() {
    this.disposeAll();
  }
  /** Same as dispose() — disposes all registrations in LIFO order. */
  disposeAll() {
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
  static from(...disposables) {
    const store = new _DisposableStore();
    for (const d of disposables) {
      store.add(d);
    }
    return store;
  }
};

// src/utils/Logger.ts
var import_vscode = require("vscode");
var Logger = class {
  _channel = import_vscode.window.createOutputChannel("OpenCode", {
    log: true
  });
  /** Log an informational message. */
  info(msg) {
    this._channel.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] [INFO] ${msg}`);
  }
  /** Log a warning message. */
  warn(msg) {
    this._channel.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] [WARN] ${msg}`);
  }
  /** Log an error message. */
  error(msg) {
    this._channel.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] [ERROR] ${msg}`);
  }
  /** Dispose the underlying output channel. */
  dispose() {
    this._channel.dispose();
  }
};
var logger = new Logger();

// src/services/ServerService.ts
var cp = __toESM(require("child_process"));
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var vscode = __toESM(require("vscode"));

// src/utils/process.ts
var import_child_process = require("child_process");
var ProcessRegistry = class {
  static _registry = /* @__PURE__ */ new Map();
  /**
   * Register a child process.  Its pid is tracked and a one-shot `'exit'`
   * listener will auto-remove the entry when the process terminates.
   */
  static register(proc) {
    const pid = proc.pid;
    if (pid === void 0) {
      return;
    }
    this._registry.set(pid, proc);
    proc.on("exit", () => {
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
  static kill(pid) {
    if (process.platform === "win32") {
      (0, import_child_process.spawnSync)("taskkill", ["/pid", String(pid), "/f", "/t"]);
      return true;
    }
    try {
      process.kill(-pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
  /** Kill every registered process and clear the registry. */
  static killAll() {
    for (const pid of this._registry.keys()) {
      this.kill(pid);
    }
    this._registry.clear();
  }
};

// src/services/ServerService.ts
var LISTENING_PATTERN = /opencode server listening on http:\/\/(.+):(\d+)/;
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 4096;
var HEALTH_POLL_INTERVAL_MS = 500;
var STARTUP_TIMEOUT_MS = 3e4;
var ServerService = class {
  // -----------------------------------------------------------------------
  // Public callback
  // -----------------------------------------------------------------------
  /** Set this to receive state-change notifications. */
  onStateChange;
  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------
  _state = "disconnected";
  _serverInfo = null;
  _process = null;
  /** True when `stop()` is in progress — suppresses crash→error transitions. */
  _stopping = false;
  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------
  /** Current connection state. */
  get state() {
    return this._state;
  }
  /**
   * Transition to a new state.  If the state actually changes, the
   * {@link onStateChange} callback is fired synchronously.
   */
  _setState(newState) {
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
  resolveOpenCodePath() {
    const configured = vscode.workspace.getConfiguration("vscode-opencode").get("opencodePath");
    if (configured && configured.trim().length > 0) {
      return configured.trim();
    }
    const shellPath = this._shellLookup();
    if (shellPath) {
      return shellPath;
    }
    const fallbackPath = this._findFallbackPath();
    if (fallbackPath) {
      return fallbackPath;
    }
    throw new Error(
      "Could not locate the opencode executable. Set 'vscode-opencode.opencodePath' in your VS Code settings, or ensure opencode is on your PATH."
    );
  }
  /**
   * Run `where opencode` (Windows) or `which opencode` (Unix).
   * Returns the first match or `null`.
   */
  _shellLookup() {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "where" : "which";
    try {
      const result = cp.execSync(`${cmd} opencode`, {
        encoding: "utf-8",
        timeout: 5e3
      });
      const lines = result.trim().split(/\r?\n/);
      if (isWin) {
        const extPattern = /\.(cmd|exe|bat)$/i;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && extPattern.test(trimmed)) {
            return trimmed;
          }
        }
        const first2 = lines[0]?.trim();
        if (first2 && first2.length > 0) {
          return `${first2}.cmd`;
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
  _findFallbackPath() {
    if (process.platform === "win32") {
      return this._findFallbackPathWindows();
    }
    return this._findFallbackPathUnix();
  }
  /** Windows fallback candidate paths. */
  _findFallbackPathWindows() {
    const candidates = [];
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(path.join(appData, "npm", "opencode.cmd"));
    }
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(
        path.join(localAppData, "nvmw", "nodejs", "opencode.cmd")
      );
    }
    const progFiles = process.env.ProgramFiles;
    if (progFiles) {
      candidates.push(path.join(progFiles, "nodejs", "opencode.cmd"));
    }
    return this._firstExisting(candidates);
  }
  /** macOS / Linux fallback candidate paths. */
  _findFallbackPathUnix() {
    const candidates = [
      "/usr/local/bin/opencode"
    ];
    const home = os.homedir();
    if (home) {
      candidates.push(path.join(home, ".npm-global", "bin", "opencode"));
      const nvmDir = process.env.NVM_DIR ?? path.join(home, ".nvm");
      const versionsDir = path.join(nvmDir, "versions", "node");
      try {
        const entries = fs.readdirSync(versionsDir, {
          withFileTypes: true
        });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            candidates.push(
              path.join(versionsDir, entry.name, "bin", "opencode")
            );
          }
        }
      } catch {
      }
    }
    return this._firstExisting(candidates);
  }
  /** Return the first candidate that exists on disk, or `null`. */
  _firstExisting(candidates) {
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          return p;
        }
      } catch {
      }
    }
    return null;
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
  async start(projectRoot) {
    if (this._process) {
      await this.stop();
    }
    this._stopping = false;
    this._setState("connecting");
    let opencodePath = this.resolveOpenCodePath();
    const hexDump = [...opencodePath].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    console.log(`[OpenCode] Resolved binary: ${opencodePath}`);
    console.log(`[OpenCode] Resolved binary hex: ${hexDump}`);
    if (!fs.existsSync(opencodePath)) {
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
        `OpenCode executable not found at: ${opencodePath}. Set 'vscode-opencode.opencodePath' in your VS Code settings, or ensure opencode is on your PATH.`
      );
    }
    console.log(`[OpenCode] Spawning: ${opencodePath} serve (cwd: ${projectRoot})`);
    const spawnOpts = {
      cwd: projectRoot,
      detached: true,
      stdio: "pipe",
      windowsHide: true
    };
    let proc;
    try {
      if (process.platform === "win32" && opencodePath.endsWith(".cmd")) {
        proc = cp.spawn("cmd.exe", ["/c", opencodePath, "serve"], spawnOpts);
      } else {
        proc = cp.spawn(opencodePath, ["serve"], spawnOpts);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[OpenCode] spawn failed: ${msg}`);
      console.error(`[OpenCode] spawn path: ${opencodePath}`);
      console.error(`[OpenCode] spawn path hex: ${hexDump}`);
      throw new Error(
        `Failed to spawn opencode process: ${msg}. Path: ${opencodePath}. Verify that the path points to a valid executable.`
      );
    }
    this._process = proc;
    ProcessRegistry.register(proc);
    console.log(`[OpenCode] Process spawned, PID: ${proc.pid}`);
    proc.on("exit", (code, signal) => {
      console.log(`[OpenCode] Process exited: code=${code}, signal=${signal}`);
      this._process = null;
      if (!this._stopping && this._state !== "disconnected") {
        this._setState("error");
      }
    });
    proc.stderr?.on("data", (chunk) => {
      console.error(`[OpenCode] stderr: ${chunk.toString().trim()}`);
    });
    proc.stdout?.on("data", (chunk) => {
      console.log(`[OpenCode] stdout: ${chunk.toString().trim()}`);
    });
    const serverInfo = await this._waitForListeningUrl(proc);
    this._serverInfo = serverInfo;
    const healthy = await this.waitForHealth(STARTUP_TIMEOUT_MS);
    if (!healthy) {
      this._stopping = true;
      if (this._process) {
        this._stopProcess();
      }
      this._setState("error");
      throw new Error(
        "OpenCode server started but health check failed within the timeout."
      );
    }
    this._setState("connected");
    return serverInfo;
  }
  /**
   * Read stdout line-by-line until the listening URL pattern is matched
   * or the timeout expires.
   */
  _waitForListeningUrl(proc) {
    return new Promise((resolve2, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "Timed out waiting for opencode server to report its listening URL."
          )
        );
      }, STARTUP_TIMEOUT_MS);
      let buffer = "";
      const onData = (chunk) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const match = LISTENING_PATTERN.exec(line);
          if (match) {
            const host = match[1] ?? DEFAULT_HOST;
            const port = parseInt(match[2] ?? String(DEFAULT_PORT), 10);
            cleanup();
            const baseUrl = `http://${host}:${port}`;
            resolve2({
              host,
              port,
              baseUrl
            });
            return;
          }
        }
      };
      const onExit = () => {
        cleanup();
        reject(
          new Error("OpenCode server process exited before reporting its listening URL.")
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
  async checkHealth() {
    if (!this._serverInfo) {
      return false;
    }
    try {
      const response = await fetch(
        `${this._serverInfo.baseUrl}/global/health`,
        { signal: AbortSignal.timeout(5e3) }
      );
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      if (typeof body === "object" && body !== null && "healthy" in body) {
        return body.healthy === true;
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
  async waitForHealth(timeoutMs) {
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
  _delay(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
  // -----------------------------------------------------------------------
  // stop
  // -----------------------------------------------------------------------
  /**
   * Kill the managed server process and transition to `"disconnected"`.
   */
  async stop() {
    this._stopping = true;
    this._stopProcess();
    this._serverInfo = null;
    this._stopping = false;
    this._setState("disconnected");
  }
  /** Kill the spawned process via {@link ProcessRegistry}. */
  _stopProcess() {
    const proc = this._process;
    if (!proc || proc.pid === void 0) {
      this._process = null;
      return;
    }
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
  getClient() {
    if (!this._serverInfo) {
      throw new Error(
        "Server is not running. Call start() before getClient()."
      );
    }
    return { baseUrl: this._serverInfo.baseUrl };
  }
};

// src/services/SessionService.ts
function mapFileDiff(raw) {
  return {
    path: raw.file,
    additions: raw.additions,
    deletions: raw.deletions
  };
}
function mapSessionSummary(raw) {
  const diffs = raw.diffs?.map(mapFileDiff);
  return {
    additions: raw.additions,
    deletions: raw.deletions,
    files: raw.files,
    ...diffs !== void 0 ? { diffs } : {}
  };
}
function mapShareInfo(raw) {
  return { url: raw.url };
}
function mapSessionTime(raw) {
  return {
    created: raw.created,
    updated: raw.updated,
    compacting: raw.compacting
  };
}
function mapRevertInfo(raw) {
  return {
    messageId: raw.messageID,
    partId: raw.partID,
    snapshot: raw.snapshot,
    diff: raw.diff
  };
}
function mapSession(raw) {
  return {
    id: raw.id,
    projectId: raw.projectID,
    parentId: raw.parentID,
    directory: raw.directory,
    title: raw.title,
    version: raw.version,
    ...raw.summary ? { summary: mapSessionSummary(raw.summary) } : {},
    ...raw.share ? { share: mapShareInfo(raw.share) } : {},
    ...raw.time ? { time: mapSessionTime(raw.time) } : {},
    ...raw.revert ? { revert: mapRevertInfo(raw.revert) } : {}
  };
}
function mapProjectTime(raw) {
  return {
    created: raw.created,
    updated: raw.initialized
  };
}
function mapProject(raw) {
  return {
    id: raw.id,
    worktree: raw.worktree,
    vcsDir: raw.vcsDir,
    vcs: raw.vcs,
    ...raw.time ? { time: mapProjectTime(raw.time) } : {}
  };
}
function mapPath(raw) {
  return {
    state: raw.state,
    config: raw.config,
    worktree: raw.worktree,
    directory: raw.directory
  };
}
var SessionServiceError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "SessionServiceError";
  }
  status;
};
var SessionService = class {
  baseUrl;
  /**
   * @param baseUrl — full base URL of the OpenCode server,
   *   e.g. `http://localhost:4096`.
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }
  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------
  /**
   * List all sessions for a given directory.
   *
   * Calls `GET /session?directory={dir}`.
   */
  async listSessions(directory) {
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, "listSessions");
    const data = await response.json();
    return data.map(mapSession);
  }
  /**
   * Create a new session in the given directory.
   *
   * Calls `POST /session?directory={dir}` with a JSON body
   * `{ title }`.
   */
  async createSession(directory, title = "VS Code OpenCode") {
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    await this.assertOk(response, "createSession");
    const data = await response.json();
    return mapSession(data);
  }
  // -----------------------------------------------------------------------
  // Paths
  // -----------------------------------------------------------------------
  /**
   * Get path information for a specific directory.
   *
   * Calls `GET /path?directory={dir}`.
   */
  async getPath(directory) {
    const url = `${this.baseUrl}/path?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, "getPath");
    const data = await response.json();
    return mapPath(data);
  }
  /**
   * Get the server's own path information (no directory filter).
   *
   * Calls `GET /path`.
   */
  async getServerPath() {
    const url = `${this.baseUrl}/path`;
    const response = await fetch(url);
    await this.assertOk(response, "getServerPath");
    const data = await response.json();
    return mapPath(data);
  }
  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------
  /**
   * List all known projects for a given directory.
   *
   * Calls `GET /project?directory={dir}`.
   */
  async listProjects(directory) {
    const url = `${this.baseUrl}/project?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, "listProjects");
    const data = await response.json();
    return data.map(mapProject);
  }
  /**
   * Get the current project info for a given directory.
   *
   * Calls `GET /project/current?directory={dir}`.
   */
  async getCurrentProject(directory) {
    const url = `${this.baseUrl}/project/current?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, "getCurrentProject");
    const data = await response.json();
    return mapProject(data);
  }
  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------
  async assertOk(response, method) {
    if (!response.ok) {
      let body = "";
      try {
        body = await response.text();
      } catch {
      }
      throw new SessionServiceError(
        `${method} failed with ${response.status}: ${body}`,
        response.status
      );
    }
  }
};

// src/services/ConnectionMonitor.ts
var ConnectionMonitor = class {
  _checkHealth;
  _intervalMs;
  _interval = null;
  _isHealthy = false;
  _wasConnected = false;
  _initialized = false;
  /** Fired when health transitions from healthy → unhealthy. */
  onConnectionLost = null;
  /** Fired when health transitions from unhealthy → healthy. */
  onConnectionRestored = null;
  /**
   * @param checkHealth — Async function that returns `true` when the
   * server is healthy.
   * @param intervalMs — Polling interval in milliseconds (default 5000).
   */
  constructor(checkHealth, intervalMs = 5e3) {
    this._checkHealth = checkHealth;
    this._intervalMs = intervalMs;
  }
  /** Whether the most recent health check passed. */
  get isHealthy() {
    return this._isHealthy;
  }
  /**
   * Start periodic health checks. Runs an immediate first poll, then
   * repeats on the configured interval. Idempotent — safe to call
   * after already started.
   */
  start() {
    if (this._interval !== null) {
      return;
    }
    void this._poll();
    this._interval = setInterval(() => {
      void this._poll();
    }, this._intervalMs);
  }
  /**
   * Stop periodic health checks. Idempotent — safe to call multiple
   * times or when already stopped.
   */
  stop() {
    if (this._interval === null) {
      return;
    }
    clearInterval(this._interval);
    this._interval = null;
  }
  /** Dispose the monitor, stopping all polling. Implements `vscode.Disposable`. */
  dispose() {
    this.stop();
  }
  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------
  async _poll() {
    try {
      const healthy = await this._checkHealth();
      this._handleResult(healthy);
    } catch {
      this._handleResult(false);
    }
  }
  _handleResult(healthy) {
    if (this._initialized) {
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
};

// src/utils/path.ts
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));
function normalizePath(p) {
  return path2.resolve(p).replace(/\\/g, "/");
}
function findGitRoot(startDir) {
  let current = path2.resolve(startDir);
  while (true) {
    const gitPath = path2.join(current, ".git");
    try {
      const stat = fs2.statSync(gitPath);
      if (stat.isDirectory() || stat.isFile()) {
        return current;
      }
    } catch {
    }
    const parent = path2.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

// src/services/ServerController.ts
var IDLE_SHUTDOWN_MS = 5 * 60 * 1e3;
var IDLE_CHECK_INTERVAL_MS = 1e4;
var WORKSPACE_CHECK_INTERVAL_MS = 5e3;
var ServerController = class {
  // -----------------------------------------------------------------------
  // Owned services
  // -----------------------------------------------------------------------
  _serverService;
  _sessionService = null;
  _connectionMonitor = null;
  // -----------------------------------------------------------------------
  // Tracked state
  // -----------------------------------------------------------------------
  _projectRoot = "";
  _sessionId = "";
  _baseUrl = "";
  // -----------------------------------------------------------------------
  // Timers
  // -----------------------------------------------------------------------
  _workspaceCheckInterval = null;
  _idleTimeout = null;
  _idleCheckInterval = null;
  // -----------------------------------------------------------------------
  // Public callbacks / events
  // -----------------------------------------------------------------------
  /** Fired when the connection monitor detects a healthy → unhealthy transition. */
  onConnectionLost = null;
  /** Fired when the connection monitor detects an unhealthy → healthy transition. */
  onConnectionRestored = null;
  /** Fired when `GET /path` reports a directory that differs from the tracked project root. */
  onWorkspaceMismatch = null;
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
  async start(projectRoot) {
    this._cancelIdleShutdown();
    const healthy = await this._serverService.checkHealth();
    if (!healthy) {
      const serverInfo = await this._serverService.start(projectRoot);
      this._baseUrl = serverInfo.baseUrl;
    } else {
      const { baseUrl } = this._serverService.getClient();
      this._baseUrl = baseUrl;
    }
    this._sessionService = new SessionService(this._baseUrl);
    const normalizedRoot = normalizePath(projectRoot);
    const sessions = await this._sessionService.listSessions(projectRoot);
    const existing = sessions.find(
      (s) => s.directory && normalizePath(s.directory) === normalizedRoot
    );
    let session;
    if (existing) {
      session = existing;
    } else {
      session = await this._sessionService.createSession(
        projectRoot,
        "VS Code OpenCode"
      );
    }
    this._sessionId = session.id;
    this._projectRoot = normalizedRoot;
    if (this._connectionMonitor) {
      this._connectionMonitor.dispose();
    }
    this._connectionMonitor = new ConnectionMonitor(
      () => this._serverService.checkHealth()
    );
    this._connectionMonitor.onConnectionLost = () => {
      this.onConnectionLost?.();
    };
    this._connectionMonitor.onConnectionRestored = () => {
      this.onConnectionRestored?.();
    };
    this._connectionMonitor.start();
    this._startWorkspaceCheck();
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
  getSessionUrl() {
    if (!this._baseUrl || !this._sessionId) {
      throw new Error(
        "Server not started. Call start() before getSessionUrl()."
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
  async stop() {
    this._cancelIdleShutdown();
    this._stopWorkspaceCheck();
    if (this._connectionMonitor) {
      this._connectionMonitor.dispose();
      this._connectionMonitor = null;
    }
    this._sessionService = null;
    this._sessionId = "";
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
  async isAgentBusy() {
    if (!this._baseUrl || !this._sessionId) {
      return false;
    }
    try {
      const response = await fetch(
        `${this._baseUrl}/session/${this._sessionId}/status`,
        { signal: AbortSignal.timeout(5e3) }
      );
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      if (typeof data === "object" && data !== null && "status" in data) {
        const status = String(
          data.status
        ).toLowerCase();
        return status.includes("busy") || status.includes("working");
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
  updateProjectRoot(newRoot) {
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
  _startWorkspaceCheck() {
    this._stopWorkspaceCheck();
    this._workspaceCheckInterval = setInterval(async () => {
      try {
        if (!this._sessionService) {
          return;
        }
        const pathInfo = await this._sessionService.getServerPath();
        const serverDir = pathInfo.directory;
        if (serverDir && normalizePath(serverDir) !== this._projectRoot) {
          this.onWorkspaceMismatch?.();
        }
      } catch {
      }
    }, WORKSPACE_CHECK_INTERVAL_MS);
  }
  _stopWorkspaceCheck() {
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
  _scheduleIdleShutdown() {
    this._cancelIdleShutdown();
    this._idleTimeout = setTimeout(() => {
      this._idleCheckInterval = setInterval(async () => {
        try {
          const busy = await this.isAgentBusy();
          if (!busy) {
            await this.stop();
          }
        } catch {
        }
      }, IDLE_CHECK_INTERVAL_MS);
    }, IDLE_SHUTDOWN_MS);
  }
  /** Clear both the idle timeout and the busy-check interval. */
  _cancelIdleShutdown() {
    if (this._idleTimeout !== null) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }
    if (this._idleCheckInterval !== null) {
      clearInterval(this._idleCheckInterval);
      this._idleCheckInterval = null;
    }
  }
};
var instance = null;
function getServerController() {
  if (!instance) {
    instance = new ServerController();
  }
  return instance;
}

// src/services/ProxyServer.ts
var http = __toESM(require("http"));

// src/views/templates/loading.html
var loading_default = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #d4d4d4);
        display: flex; justify-content: center; align-items: center;
        height: 100vh; margin: 0; padding: 20px;
        user-select: none; -webkit-user-select: none;
    }
    .loading-container { text-align: center; }
    .spinner { width: 40px; height: 40px; margin: 0 auto 20px;
        border: 3px solid var(--vscode-editorWidget-border, #3c3c3c);
        border-top-color: var(--vscode-focusBorder, #007acc);
        border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { font-size: 14px; color: var(--vscode-descriptionForeground, #999); }
</style>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">{{message}}</div>
    </div>
</body>
</html>
`;

// src/views/templates/error.html
var error_default = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #d4d4d4);
        display: flex; justify-content: center; align-items: center;
        height: 100vh; margin: 0; padding: 20px;
        user-select: none; -webkit-user-select: none;
    }
    .error-container { text-align: center; max-width: 420px; }
    .error-icon { font-size: 48px; margin-bottom: 16px; }
    .error-message { font-size: 14px; line-height: 1.6; margin-bottom: 24px; word-wrap: break-word; }
    button { background: var(--vscode-button-background, #007acc);
        color: var(--vscode-button-foreground, #fff);
        border: none; padding: 8px 24px; font-size: 14px;
        border-radius: 4px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground, #1c97e8); }
</style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">&#9888;</div>
        <div class="error-message">{{message}}</div>
        {{retryScript}}
    </div>
</body>
</html>
`;

// src/views/templates/iframe.html
var iframe_default = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCode</title>
<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;
        background:var(--vscode-editor-background,#1e1e1e)}
    iframe{width:100%;height:100%;border:none}
</style>
</head>
<body>
    <iframe src="{{src}}"></iframe>
    <script>
        const vscode = acquireVsCodeApi();
        const iframe = document.querySelector('iframe');
        iframe.addEventListener('load', () => {
            vscode.postMessage({ type: 'ready' });
        });
    </script>
</body>
</html>
`;

// src/views/templates.ts
function fill(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
function getLoadingPageHtml(message) {
  return fill(loading_default, { message: escapeHtml(message) });
}
function getErrorPageHtml(message, canRetry) {
  const messageHtml = message.split("\n").map((line) => escapeHtml(line)).join("<br>");
  const retryScript = canRetry ? `<button id="retry-btn">Retry</button>
<script>
const vscode = acquireVsCodeApi();
document.getElementById('retry-btn').addEventListener('click', () => {
    vscode.postMessage({ type: 'retry' });
});
</script>` : "";
  return fill(error_default, { message: messageHtml, retryScript });
}
function getIframeHtml(src) {
  return fill(iframe_default, { src: escapeAttr(src) });
}
function getProxyLoadingHtml() {
  return loading_default.replace("{{message}}", "Loading OpenCode\u2026");
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/services/ProxyServer.ts
var PROXY_PORT_BASE = 15e3;
var PROXY_PORT_RANGE = 1e3;
var MAX_PORT_RETRIES = 10;
var CSP_HEADERS = /* @__PURE__ */ new Set([
  "content-security-policy",
  "content-security-policy-report-only"
]);
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade"
]);
var HTML_CT_PREFIX = "text/html";
var SSE_CT_PREFIX = "text/event-stream";
var ProxyServer = class {
  // -----------------------------------------------------------------------
  // Fields
  // -----------------------------------------------------------------------
  targetUrl;
  server = null;
  portValue = 0;
  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  /**
   * @param targetUrl The OpenCode server base URL (e.g. `http://127.0.0.1:4096`).
   */
  constructor(targetUrl) {
    this.targetUrl = targetUrl.replace(/\/+$/, "");
  }
  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------
  /**
   * Create the HTTP server, bind to a stable port derived from the target
   * URL, and begin accepting connections.
   *
   * @returns The port number the server is listening on.
   */
  async start() {
    if (this.server) {
      return this.portValue;
    }
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });
    const basePort = this._computePort();
    this.portValue = await this._listenWithRetry(basePort);
    return this.portValue;
  }
  /**
   * Shut down the HTTP server.
   */
  async stop() {
    if (!this.server) {
      return;
    }
    return new Promise((resolve2, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this.portValue = 0;
          resolve2();
        }
      });
    });
  }
  /**
   * {@link Disposable} implementation — closes the server synchronously
   * (fire-and-forget).
   */
  dispose() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.portValue = 0;
    }
  }
  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------
  /** Full proxy origin (e.g. `http://localhost:15042`). */
  getProxyUrl() {
    return `http://127.0.0.1:${this.portValue}`;
  }
  // -----------------------------------------------------------------------
  // Port computation (DJB2 hash → stable port)
  // -----------------------------------------------------------------------
  _computePort() {
    const hash = this._djb2(this.targetUrl);
    return PROXY_PORT_BASE + hash % PROXY_PORT_RANGE;
  }
  /**
   * DJB2 string hash — small, fast, deterministic across processes.
   * Returns an unsigned 32-bit integer.
   */
  _djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i) | 0;
    }
    return hash >>> 0;
  }
  /**
   * Attempt to listen on `startPort`.  If the port is already bound,
   * increment and retry up to {@link MAX_PORT_RETRIES} times.
   */
  _listenWithRetry(startPort) {
    return new Promise((resolve2, reject) => {
      let attempts = 0;
      const tryPort = (port) => {
        if (attempts > MAX_PORT_RETRIES) {
          reject(
            new Error(
              `ProxyServer: failed to bind after ${MAX_PORT_RETRIES} port attempts (started at ${startPort})`
            )
          );
          return;
        }
        attempts++;
        const onError = (err) => {
          if (err.code === "EADDRINUSE") {
            tryPort(port + 1);
          } else {
            reject(err);
          }
        };
        this.server.once("error", onError);
        this.server.listen(port, "127.0.0.1", () => {
          this.server.removeListener("error", onError);
          resolve2(port);
        });
      };
      tryPort(startPort);
    });
  }
  // -----------------------------------------------------------------------
  // Request routing
  // -----------------------------------------------------------------------
  _handleRequest(req, res) {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    if (method === "GET" && url === "/inject.js") {
      this._serveInjectScript(res);
    } else if (method === "GET" && url === "/") {
      this._serveLoadingPage(res);
    } else {
      this._proxyRequest(req, res);
    }
  }
  // -----------------------------------------------------------------------
  // Built-in routes
  // -----------------------------------------------------------------------
  /** Serve the placeholder inject script. */
  _serveInjectScript(res) {
    const body = "// OpenCode VS Code extension - inject script placeholder\n";
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Content-Length": Buffer.byteLength(body)
    });
    res.end(body);
  }
  /** Serve a minimal loading page with a CSS spinner. */
  _serveLoadingPage(res) {
    const html = getProxyLoadingHtml();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html)
    });
    res.end(html);
  }
  // -----------------------------------------------------------------------
  // Proxying
  // -----------------------------------------------------------------------
  /**
   * Forward the incoming request to the upstream OpenCode server, strip
   * CSP headers from the response, inject the script tag into HTML, and
   * pass SSE streams through without buffering.
   */
  _proxyRequest(clientReq, clientRes) {
    const target = new URL(this.targetUrl);
    const fwdHeaders = {};
    for (const [key, value] of Object.entries(clientReq.headers)) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower)) {
        continue;
      }
      if (value === void 0) {
        continue;
      }
      fwdHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    fwdHeaders.host = target.host;
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: clientReq.url ?? "/",
        method: clientReq.method ?? "GET",
        headers: fwdHeaders
      },
      (proxyRes) => {
        this._handleProxyResponse(clientRes, proxyRes);
      }
    );
    proxyReq.on("error", (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
        clientRes.end(`Proxy error: ${err.message}`);
      } else {
        clientRes.destroy();
      }
    });
    const method = (clientReq.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      proxyReq.end();
    } else {
      clientReq.pipe(proxyReq);
      clientReq.once("close", () => {
        if (!proxyReq.destroyed) {
          proxyReq.destroy();
        }
      });
    }
  }
  /**
   * Process the upstream response: strip CSP, inject into HTML,
   * passthrough SSE, or pipe unchanged.
   */
  _handleProxyResponse(clientRes, proxyRes) {
    const contentType = this._firstHeader(proxyRes.headers, "content-type");
    const resHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value === void 0) {
        continue;
      }
      if (CSP_HEADERS.has(key.toLowerCase())) {
        continue;
      }
      resHeaders[key] = value;
    }
    const statusCode = proxyRes.statusCode ?? 200;
    if (contentType?.startsWith(SSE_CT_PREFIX)) {
      clientRes.writeHead(statusCode, resHeaders);
      proxyRes.pipe(clientRes);
      return;
    }
    if (contentType?.startsWith(HTML_CT_PREFIX)) {
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf-8");
          const modified = this._injectScriptTag(body);
          resHeaders["content-length"] = Buffer.byteLength(modified);
          for (const k of Object.keys(resHeaders)) {
            if (k.toLowerCase() === "transfer-encoding") {
              delete resHeaders[k];
            }
          }
          clientRes.writeHead(statusCode, resHeaders);
          clientRes.end(modified);
        } catch {
          clientRes.writeHead(statusCode, resHeaders);
          clientRes.end(Buffer.concat(chunks));
        }
      });
      proxyRes.on("error", () => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end();
        }
      });
      return;
    }
    clientRes.writeHead(statusCode, resHeaders);
    proxyRes.pipe(clientRes);
  }
  // -----------------------------------------------------------------------
  // HTML script injection
  // -----------------------------------------------------------------------
  /**
   * Insert `<script src="/inject.js"></script>` into an HTML string just
   * before `</head>` (preferred) or `</body>` (fallback).
   */
  _injectScriptTag(html) {
    const scriptTag = '<script src="/inject.js"></script>';
    const headClose = /<\/head>/i;
    if (headClose.test(html)) {
      return html.replace(headClose, `${scriptTag}
</head>`);
    }
    const bodyClose = /<\/body>/i;
    if (bodyClose.test(html)) {
      return html.replace(bodyClose, `${scriptTag}
</body>`);
    }
    return html + `
${scriptTag}`;
  }
  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  /**
   * Return the first value of a header from an {@link IncomingHttpHeaders}
   * object, respecting the fact that headers can be `string | string[]`.
   */
  _firstHeader(headers, name) {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value ?? void 0;
  }
};

// src/services/ProjectRootResolver.ts
var os2 = __toESM(require("os"));
var vscode2 = __toESM(require("vscode"));
var ProjectRootResolver = class {
  /**
   * Determine the project root using the following priority chain:
   *
   * 1. The first workspace folder (`vscode.workspace.workspaceFolders[0]`)
   *    — normalized via {@link normalizePath}.
   * 2. Git repository root discovered by walking up from the workspace folder.
   * 3. Git repository root discovered by walking up from the user's home
   *    directory.
   * 4. Fallback: the user's home directory (normalized).
   */
  resolve() {
    const workspaceFolder = vscode2.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      return normalizePath(workspaceFolder);
    }
    const gitRoot = findGitRoot(workspaceFolder ?? os2.homedir());
    if (gitRoot) {
      return normalizePath(gitRoot);
    }
    return normalizePath(os2.homedir());
  }
};

// src/views/ToolWebviewProvider.ts
var vscode3 = __toESM(require("vscode"));
var ToolWebviewProvider = class {
  // -----------------------------------------------------------------------
  // Fields
  // -----------------------------------------------------------------------
  _view = null;
  /** Error queued before resolveWebviewView() — flushed when the view becomes ready. */
  _pendingError = null;
  _extensionUri;
  _getProxyUrl;
  _onDidRequestRetry = new vscode3.EventEmitter();
  /** Fires when the user clicks the retry button on the error page. */
  onDidRequestRetry = this._onDidRequestRetry.event;
  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  /**
   * @param extensionUri The extension's root URI (for resolving bundled
   *   resources — currently unused but required for future template loading).
   * @param getProxyUrl A function that returns the local proxy server's
   *   origin (e.g. `http://127.0.0.1:15042`), typically sourced from
   *   {@link ProxyServer.getProxyUrl}.
   */
  constructor(extensionUri, getProxyUrl) {
    this._extensionUri = extensionUri;
    this._getProxyUrl = getProxyUrl;
  }
  // -----------------------------------------------------------------------
  // vscode.WebviewViewProvider
  // -----------------------------------------------------------------------
  /**
   * Called by VS Code when the sidebar webview is first created or
   * recreated after being hidden.
   */
  resolveWebviewView(webviewView, _context, _token) {
    console.log("[OpenCode] WebView resolved, showing loading...");
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true
    };
    this.showLoading("Starting OpenCode\u2026");
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "retry":
            this._onDidRequestRetry.fire();
            break;
        }
      }
    );
    if (this._pendingError) {
      const { message, canRetry } = this._pendingError;
      this._pendingError = null;
      this._view.webview.html = getErrorPageHtml(message, canRetry);
    }
  }
  // -----------------------------------------------------------------------
  // Public navigation / display helpers
  // -----------------------------------------------------------------------
  /**
   * Replace the webview content with an iframe that loads the given
   * session URL through the local proxy.
   *
   * @param sessionUrl The path to load (e.g. `"/"` or `"/session/abc123"`).
   *   This is appended to the proxy origin returned by `getProxyUrl()`.
   */
  navigateToSession(sessionUrl) {
    if (!this._view) {
      return;
    }
    const proxyUrl = this._getProxyUrl();
    const src = sessionUrl.startsWith("/") ? `${proxyUrl}${sessionUrl}` : `${proxyUrl}/${sessionUrl}`;
    this._view.webview.html = getIframeHtml(src);
  }
  /**
   * Show a loading spinner with a message.
   */
  showLoading(message) {
    if (!this._view) {
      return;
    }
    const html = getLoadingPageHtml(message);
    console.log(`[OpenCode] Loading HTML length: ${html.length}`);
    this._view.webview.html = html;
  }
  /**
   * Show an error display.
   *
   * @param message Human-readable error description.
   * @param canRetry When `true`, a retry button is rendered that fires
   *   {@link onDidRequestRetry} when clicked.
   */
  showError(message, canRetry) {
    if (!this._view) {
      this._pendingError = { message, canRetry };
      return;
    }
    this._view.webview.html = getErrorPageHtml(message, canRetry);
  }
  /**
   * Send an arbitrary message to the webview.
   *
   * Safe to call before {@link resolveWebviewView} — silently no-ops
   * when `_view` is null.
   */
  postMessage(data) {
    this._view?.webview.postMessage(data);
  }
  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------
  /**
   * Dispose the retry event emitter and clear the view reference.
   * Called by the extension controller on deactivation.
   */
  dispose() {
    this._onDidRequestRetry.dispose();
    this._view = null;
  }
};

// src/theme.ts
var vscode4 = __toESM(require("vscode"));
function setupThemeSync(context, postMessageToWebview) {
  const sendTheme = (theme) => {
    postMessageToWebview({ type: "themeChanged", kind: theme.kind });
  };
  sendTheme(vscode4.window.activeColorTheme);
  context.subscriptions.push(
    vscode4.window.onDidChangeActiveColorTheme(sendTheme)
  );
}

// src/commands/registerCommands.ts
var vscode5 = __toESM(require("vscode"));
function registerCommands(context) {
  context.subscriptions.push(
    vscode5.commands.registerCommand("vscode-opencode.openToolWindow", () => {
      vscode5.commands.executeCommand("workbench.view.extension.vscode-opencode");
      vscode5.window.showInformationMessage("OpenCode tool window opened.");
    })
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("vscode-opencode.refreshToolWindow", () => {
      vscode5.window.showInformationMessage("Refreshing OpenCode...");
    })
  );
}

// src/ExtensionController.ts
var ExtensionController = class {
  context;
  disposables = new DisposableStore();
  logger;
  provider;
  proxyServer = null;
  constructor(context) {
    this.context = context;
  }
  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------
  /** Wire everything up. Called once by `extension.activate()`. */
  activate() {
    this.logger = new Logger();
    this.disposables.add(this.logger);
    this.logger.info("OpenCode extension activating\u2026");
    registerCommands(this.context);
    const serverController = getServerController();
    const rootResolver = new ProjectRootResolver();
    let projectRoot = rootResolver.resolve();
    this.provider = new ToolWebviewProvider(
      this.context.extensionUri,
      () => this.proxyServer?.getProxyUrl() ?? "http://127.0.0.1:0"
    );
    this.disposables.add(
      vscode6.window.registerWebviewViewProvider(
        "vscode-opencode.toolWindow",
        this.provider
      )
    );
    setupThemeSync(this.context, (data) => this.provider.postMessage(data));
    serverController.onConnectionLost = () => {
      this.provider.showError(
        "Connection to OpenCode server lost.",
        true
      );
    };
    serverController.onConnectionRestored = () => {
      try {
        const sessionPath = new URL(
          serverController.getSessionUrl()
        ).pathname;
        this.provider.navigateToSession(sessionPath);
      } catch {
      }
    };
    serverController.onWorkspaceMismatch = () => {
      this.logger.info(
        "Workspace mismatch detected, re-resolving project root\u2026"
      );
      projectRoot = rootResolver.resolve();
      serverController.updateProjectRoot(projectRoot);
      void this._startServerFlow(serverController, projectRoot);
    };
    this.provider.onDidRequestRetry(() => {
      this.logger.info("Retry requested by user");
      void this._startServerFlow(serverController, projectRoot);
    });
    this.disposables.add(
      vscode6.workspace.onDidChangeWorkspaceFolders((event) => {
        this.logger.info(
          `Workspace folders changed: added=${event.added.length}, removed=${event.removed.length}`
        );
        projectRoot = rootResolver.resolve();
        serverController.updateProjectRoot(projectRoot);
      })
    );
    this.context.subscriptions.push(this.disposables);
    void this._startServerFlow(serverController, projectRoot);
    this.logger.info("OpenCode extension activated.");
  }
  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------
  /**
   * Tear everything down.
   *
   * Returns a `Promise<void>` so VS Code can await it (5-second
   * grace period). The DisposableStore is pushed to
   * `context.subscriptions` which VS Code also disposes, but we
   * explicitly dispose here for deterministic ordering.
   */
  async deactivate() {
    this.logger.info("OpenCode extension deactivating\u2026");
    const serverController = getServerController();
    await serverController.stop();
    if (this.proxyServer) {
      await this.proxyServer.stop();
    }
    this.provider.dispose();
    this.disposables.dispose();
    this.logger.info("OpenCode extension deactivated.");
  }
  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  /**
   * Start (or restart) the full server → proxy → webview pipeline.
   *
   * 1. Start the OpenCode server via {@link ServerController.start},
   *    which also handles session lookup/creation and starts the
   *    {@link ConnectionMonitor}.
   * 2. Create a {@link ProxyServer} pointed at the server's base URL
   *    and bind it to a local port.
   * 3. Navigate the webview to the session via the proxy.
   *
   * On failure the webview displays an error page with a retry button.
   */
  async _startServerFlow(serverController, projectRoot) {
    try {
      const result = await serverController.start(projectRoot);
      const sessionUrl = result.sessionUrl;
      const baseUrl = new URL(sessionUrl).origin;
      if (this.proxyServer) {
        await this.proxyServer.stop();
      }
      this.proxyServer = new ProxyServer(baseUrl);
      await this.proxyServer.start();
      const sessionPath = new URL(sessionUrl).pathname;
      this.provider.navigateToSession(sessionPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to start server: ${message}`);
      this.provider.showError(
        `Failed to start OpenCode: ${message}`,
        true
      );
    }
  }
};

// src/extension.ts
var controller;
function activate(context) {
  controller = new ExtensionController(context);
  controller.activate();
}
async function deactivate() {
  if (controller) {
    await controller.deactivate();
    controller = void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
