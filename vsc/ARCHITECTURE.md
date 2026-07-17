# VSCode Extension Architecture

## 1. Overview

The VS Code extension integrates the OpenCode AI coding assistant into Visual Studio Code via a sidebar WebView. It manages the full lifecycle of a local `opencode serve` process, proxies HTTP traffic through a stable local origin, syncs VS Code theme variables into the OpenCode UI, and isolates per-workspace `localStorage` so multiple projects can coexist without data leakage.

The extension activates lazily when the user first opens the tool window (command `vscode-opencode.openToolWindow`). Activation spawns the OpenCode server, discovers or creates a session, launches a local HTTP proxy, and renders the session UI in a sidebar `WebviewView` via an iframe. On deactivation the extension shuts down the server process, disposes all resources, and clears timers.

Key architectural decisions:

- **No bundler needed for dependencies** — the extension has zero runtime npm dependencies. `fetch` is native in Node 18+ (VS Code ^1.85 requires Node 18+).
- **Plain-object dependency injection** — no DI framework. Services are wired through a `ServiceContainer` interface on `ExtensionController`.
- **Local HTTP proxy** — provides a stable `localhost` origin for the webview, strips CSP headers from upstream responses, injects the theme/storage bridge script, and forwards SSE streams unbuffered.
- **Singleton `ServerController`** — orchestrates process management, session lifecycle, health monitoring, workspace mismatch detection, and idle shutdown through one module-level singleton.

---

## 2. Component Diagram

```
ExtensionController
├── ServerController (singleton orchestrator)
│   ├── ServerService ──────────── spawns opencode serve
│   ├── SessionService ─────────── REST API client (fetch wrapper)
│   ├── ConnectionMonitor ──────── periodic health polling with edge-triggered events
│   └── ProjectRootResolver ────── workspace / git root detection
├── ProxyServer ────────────────── local HTTP proxy + CSP stripping + script injection
├── ToolWebviewProvider ────────── sidebar WebView (iframe → proxy origin)
├── Theme sync ─────────────────── onDidChangeActiveColorTheme → postMessage bridge
├── Inject script ──────────────── CSS var mapping + localStorage isolation + project sidebar
└── Commands ───────────────────── openToolWindow, refreshToolWindow
```

### Component responsibilities

| Component | File | Role |
|---|---|---|
| `extension.ts` | `src/extension.ts` | Entry point; exports `activate()` / `deactivate()` |
| `ExtensionController` | `src/ExtensionController.ts` | Lifecycle owner; wires services, registers commands, subscribes workspace events |
| `ServerController` | `src/services/ServerController.ts` | Singleton orchestrator for server lifecycle, session management, monitoring |
| `ServerService` | `src/services/ServerService.ts` | Spawns/kills `opencode serve` process; health checking; state machine |
| `SessionService` | `src/services/SessionService.ts` | Typed REST client; JSON→TS key mapping layer |
| `ConnectionMonitor` | `src/services/ConnectionMonitor.ts` | Polls health endpoint; fires callbacks on state transitions (lost/restored) |
| `ProjectRootResolver` | `src/services/ProjectRootResolver.ts` | Resolves workspace root: folders → git root → home dir |
| `ProxyServer` | `src/services/ProxyServer.ts` | Local HTTP reverse proxy; stable origin; CSP removal; script injection |
| `ToolWebviewProvider` | `src/views/ToolWebviewProvider.ts` | VS Code `WebviewViewProvider`; manages loading/iframe/error states |
| `inject.ts` | `src/views/inject.ts` | Async IIFE string for webview: theme CSS, localStorage interception, project seeding |
| `templates.ts` | `src/views/templates.ts` | HTML page generators: loading spinner, error page |
| `theme.ts` | `src/theme.ts` | Bridges `onDidChangeActiveColorTheme` to webview via `postMessage` |
| `registerCommands.ts` | `src/commands/registerCommands.ts` | Registers `openToolWindow` and `refreshToolWindow` commands |
| `types.ts` | `src/types.ts` | TypeScript DTOs: `HealthInfo`, `ServerInfo`, `SessionInfo`, `PathInfo`, `ProjectInfo` |

---

## 3. Data Flow

### 3.1 Startup sequence

```
activate()
  └── new ExtensionController(context)
        └── controller.activate()
              ├── Logger created (VS Code OutputChannel "OpenCode")
              ├── ServiceContainer built (plain object, services deferred)
              ├── Commands registered (openToolWindow, refreshToolWindow)
              ├── Workspace events subscribed (onDidChangeWorkspaceFolders)
              └── DisposableStore pushed to context.subscriptions
```

When the user opens the tool window (command or sidebar icon click), the full server flow runs:

```
User opens tool window
  └── getServerController().start(projectRoot)
        ├── Cancel pending idle shutdown
        ├── ServerService.checkHealth() — reuse if healthy
        │     └── ServerService.start(projectRoot) — if not running
        │           ├── resolveOpenCodePath() (config → PATH → fallback dirs)
        │           ├── cp.spawn("opencode", ["serve"], { cwd, detached })
        │           ├── ProcessRegistry.register(proc)
        │           ├── Wait for "listening on http://host:port" on stdout
        │           ├── waitForHealth() — poll GET /global/health every 500ms
        │           └── Return ServerInfo { host, port, baseUrl }
        ├── SessionService created with baseUrl
        ├── listSessions(directory) → find or createSession()
        │     └── POST /session?directory=... { title: "VS Code OpenCode" }
        ├── ConnectionMonitor created and started (polls checkHealth every 5s)
        ├── Workspace check interval started (polls GET /path every 5s)
        ├── Idle shutdown timer scheduled (5 min → poll isAgentBusy every 10s → stop)
        └── Return { sessionUrl: "http://127.0.0.1:4096/session/{id}" }
  └── ProxyServer created with target URL
        ├── Port computed from DJB2 hash of target URL (15000-15999 range)
        ├── http.createServer() bound to 127.0.0.1
        └── Return proxy port
  └── ToolWebviewProvider.navigateToSession(sessionPath)
        └── webview.html = iframe HTML pointing at proxy origin + session path
              └── iframe loads → proxy proxies to upstream → inject.js runs in iframe
```

### 3.2 Theme synchronization

```
vscode.window.onDidChangeActiveColorTheme(theme)
  └── postMessageToWebview({ type: 'themeChanged', kind: theme.kind })
        └── inject.js: window.addEventListener('message', handler)
              ├── Remove existing <style id="vscode-theme-inject">
              └── tryInjectThemeCSS()
                    └── buildThemeCSS()
                          ├── Map --vscode-* CSS variables → OpenCode tokens (V1)
                          ├── Map --vscode-* CSS variables → V2 tokens
                          ├── Generate derived tokens (diff colors, scrollbar)
                          └── Scoped to html[data-color-scheme="dark"] and html[data-color-scheme="light"]
```

Theme variables are mapped from VS Code's injected `--vscode-*` CSS custom properties (automatically available in every webview) to OpenCode's internal token system. Two sets of mappings exist: legacy V1 tokens (`--background-base`, `--text-strong`, etc.) and V2 tokens (`--v2-background-bg-base`, `--v2-text-text-base`, etc.).

The CSS is injected as a `<style>` element scoped by `data-color-scheme`, preventing the OpenCode page's dark/light toggle from breaking the VS Code theme match.

### 3.3 Shutdown sequence

```
deactivate()
  └── controller.deactivate()
        ├── ServerController.stop()
        │     ├── Cancel idle shutdown (clearTimeout + clearInterval)
        │     ├── Stop workspace check interval
        │     ├── ConnectionMonitor.dispose() — stops health polling
        │     ├── SessionService nulled, sessionId cleared
        │     └── ServerService.stop()
        │           ├── _stopping flag set (suppresses crash→error transition)
        │           ├── process.removeAllListeners('exit')
        │           ├── ProcessRegistry.kill(pid)
        │           │     ├── Windows: taskkill /pid <pid> /f /t
        │           │     └── Unix: process.kill(-pid, 'SIGTERM') — process group
        │           └── State → 'disconnected'
        ├── ProxyServer.dispose() — http.Server.close()
        ├── ToolWebviewProvider.dispose() — event emitter cleanup
        └── DisposableStore.dispose() — LIFO disposal of all registrations
```

---

## 4. VS → VSCode Architecture Mapping

| VS (C#) | VS Code (TS) | Rationale |
|---|---|---|
| `AsyncPackage` | `ExtensionController` | Both are lifecycle entry points; activate on first use, own service wiring, handle disposal |
| `ToolWindowPane` + WPF/WebView2 | `WebviewViewProvider` + iframe | VS Code sidebar webview == VS docked tool window; both host HTML content in an embedded browser context |
| COM bridge (`chrome.webview.hostObjects`) | `postMessage` / `onDidReceiveMessage` | Standard VS Code webview message bridge; `acquireVsCodeApi().postMessage()` ↔ `webview.onDidReceiveMessage` |
| HTTP proxy (`vsoc-app` → real server) | `ProxyServer` (local HTTP proxy) | Same pattern: stable origin for webview, strips CSP, injects bridge script into HTML responses |
| `VSColorTheme` polling + COM property | `--vscode-*` CSS variables + `onDidChangeActiveColorTheme` | Simpler, native VS Code theming; CSS vars auto-injected into every webview, no polling needed |
| `DTE2` COM (project root) | `vscode.workspace.workspaceFolders` | Native VS Code workspace API; no COM interop required |
| `Job Objects` (`ProcessBinding`) | `ProcessRegistry` (cross-platform) | Platform-aware process management: `taskkill /f /t` on Windows, `SIGTERM` to process group on Unix |
| RESX satellite assemblies | `package.nls.json` / `package.nls.zh-cn.json` | VS Code standard localization via `%key%` tokens in `package.json` |
| C# nullable reference types | TypeScript `exactOptionalPropertyTypes` + `?:` | Both enforce explicit optionality; TS uses `as` assertions at the JSON mapping boundary |
| NuGet dependencies | Zero runtime npm dependencies | `fetch` is native; no HTTP client library needed |

---

## 5. Module Descriptions

### `src/extension.ts` — Entry point

Exports the two VS Code activation hooks:

```typescript
export function activate(context: vscode.ExtensionContext): void
export async function deactivate(): Promise<void>
```

Creates a module-level `ExtensionController` instance. `deactivate()` must return a `Promise<void>` so VS Code waits (up to 5 seconds) for process cleanup.

### `src/ExtensionController.ts` — Lifecycle orchestrator

**Key exports:** `class ExtensionController`

**Dependencies:** `DisposableStore`, `Logger`, VS Code API

The central wiring hub. On `activate()`: creates `Logger`, builds a `ServiceContainer` (plain object — services are added in later development waves), registers commands, subscribes to workspace folder changes, and pushes the `DisposableStore` to `context.subscriptions`. On `deactivate()`: disposes the store and all nested services.

Follows the same pattern as `VSOpenCodePackage` in the VS extension (`vs/`).

### `src/services/ServerController.ts` — Server lifecycle orchestrator

**Key exports:** `class ServerController`, `function getServerController()`

**Dependencies:** `ServerService`, `SessionService`, `ConnectionMonitor`, `path.ts`

Module-level singleton (`getServerController()`). Manages the full server lifecycle:

- `start(projectRoot)` — ensures server is running (reuses healthy process), finds or creates a session, wires up `ConnectionMonitor`, starts workspace mismatch detection, schedules idle shutdown. Returns the session URL.
- `stop()` — tears down monitoring, nulls session service, kills `opencode serve`.
- `isAgentBusy()` — queries `GET /session/{id}/status` to check `"busy"` or `"working"`.
- `updateProjectRoot(newRoot)` — updates tracked root, restarts workspace checking, reschedules idle.

**Callbacks:** `onConnectionLost`, `onConnectionRestored`, `onWorkspaceMismatch` — set by consumers to react to state changes.

**Constants:** `IDLE_SHUTDOWN_MS = 5 min`, `IDLE_CHECK_INTERVAL_MS = 10s`, `WORKSPACE_CHECK_INTERVAL_MS = 5s`

### `src/services/ServerService.ts` — Process lifecycle

**Key exports:** `class ServerService`, `type StateChangeListener`

**Dependencies:** `child_process`, `fs`, `os`, `path`, VS Code API, `ProcessRegistry`, `types.ts`

Manages the `opencode serve` child process:

- `resolveOpenCodePath()` — resolution priority: (1) VS Code config `vscode-opencode.opencodePath`, (2) `where`/`which` PATH lookup, (3) platform-specific fallback directories (AppData, nvm, /usr/local/bin)
- `start(projectRoot)` — spawns `opencode serve` with `detached: true`, waits for the listening URL pattern on stdout, polls health until available, transitions state.
- `checkHealth()` — `GET /global/health` with 5s timeout.
- `waitForHealth(timeoutMs)` — polls `checkHealth` every 500ms until deadline.
- `stop()` — kills process via `ProcessRegistry`, transitions to disconnected.
- `getClient()` — returns `{ baseUrl }` for the running server.

**State machine:** `disconnected` → `connecting` → `connected` ⊸ `error`. The `_stopping` flag suppresses the crash→error transition during intentional shutdown. The `onStateChange` callback fires only on actual transitions.

**Listening URL detection:** parses stdout lines matching `/opencode server listening on http:\/\/(.+):(\d+)/`.

### `src/services/SessionService.ts` — REST API client

**Key exports:** `class SessionService`, `class SessionServiceError`

**Dependencies:** `types.ts`, native `fetch`

Typed wrapper around the OpenCode HTTP API. Constructed with the server's `baseUrl`. All methods throw `SessionServiceError` on non-2xx responses.

**Endpoints:**
- `listSessions(directory)` — `GET /session?directory=...`
- `createSession(directory, title)` — `POST /session?directory=...`
- `getPath(directory)` — `GET /path?directory=...`
- `getServerPath()` — `GET /path`
- `listProjects(directory)` — `GET /project?directory=...`
- `getCurrentProject(directory)` — `GET /project/current?directory=...`

**JSON → TS mapping layer:** The OpenCode server uses PascalCase for ID fields (`projectID`, `parentID`, `messageID`, `partID`) and the `initialized` key for project timestamps. Private mapping functions (`mapSession`, `mapProject`, `mapPath`, etc.) convert to the camelCase TypeScript types in `types.ts`. The `exactOptionalPropertyTypes` TS config requires `as` assertions at the mapping boundary.

### `src/services/ConnectionMonitor.ts` — Health polling

**Key exports:** `class ConnectionMonitor` (implements `vscode.Disposable`)

**Dependencies:** VS Code `Disposable`

Periodically calls a health-check function and fires edge-triggered callbacks only on state transitions. The first poll establishes the baseline without firing events.

```typescript
const monitor = new ConnectionMonitor(async () => await serverService.checkHealth(), 5000);
monitor.onConnectionLost = () => { /* show warning */ };
monitor.onConnectionRestored = () => { /* show info */ };
monitor.start();
```

`dispose()` stops the polling interval. Implements `vscode.Disposable` for automatic cleanup.

### `src/services/ProjectRootResolver.ts` — Workspace detection

**Key exports:** `class ProjectRootResolver`

**Dependencies:** `path.ts`

Mirrors `vs/Services/ProjectRootResolver.cs`. Resolution chain:

1. First workspace folder (`vscode.workspace.workspaceFolders[0]`) — normalized
2. Git repository root (walked up from workspace folder)
3. Git repository root (walked up from home directory)
4. Fallback: user home directory (normalized)

### `src/services/ProxyServer.ts` — Local HTTP proxy

**Key exports:** `class ProxyServer` (implements `vscode.Disposable`)

**Dependencies:** `http`, VS Code `Disposable`

A thin local HTTP reverse proxy that serves three purposes:

1. **Stable origin** — the VS Code webview needs a consistent `localhost` origin for CORS, cookies, and `localStorage`. The proxy always binds to `127.0.0.1` on a port derived from a DJB2 hash of the target URL (range 15000-15999), ensuring the same target always gets the same proxy port across restarts.

2. **CSP stripping** — removes `Content-Security-Policy` and `Content-Security-Policy-Report-Only` response headers so the OpenCode page renders correctly inside the webview iframe.

3. **Script injection** — injects `<script src="/inject.js"></script>` into HTML responses (before `</head>` or `</body>`). Also replaces `Content-Length` and drops `Transfer-Encoding` for the modified body.

**Built-in routes:**
- `GET /inject.js` — serves the placeholder inject script (content lives in `src/views/inject.ts` as the `INJECT_SCRIPT` export, compiled into the extension bundle)
- `GET /` — serves a minimal loading page with a CSS spinner using VS Code theme variables

**SSE passthrough:** Responses with `Content-Type: text/event-stream` are piped through unbuffered to preserve the streaming protocol.

**Hop-by-hop header stripping:** `connection`, `keep-alive`, `transfer-encoding`, `proxy-*`, `te`, `trailer`, `upgrade`.

### `src/views/ToolWebviewProvider.ts` — Sidebar WebView

**Key exports:** `class ToolWebviewProvider` (implements `vscode.WebviewViewProvider`)

**Dependencies:** VS Code API

Manages the sidebar webview with three visual states:

1. **Loading** — centered CSS spinner with message (shown initially and via `showLoading()`)
2. **Iframe** — full-viewport iframe pointing at the proxy server's session URL (set via `navigateToSession()`); fires `{ type: 'ready' }` on iframe load
3. **Error** — warning icon, message text, optional retry button (set via `showError()`); retry button posts `{ type: 'retry' }` to the extension

**Message protocol:**
| Direction | Type | Payload | Purpose |
|---|---|---|---|
| webview → extension | `retry` | none | User clicked the retry button |
| webview → extension | `ready` | none | Session iframe finished loading |
| extension → webview | `themeChanged` | `{ kind: number }` | VS Code theme changed (ColorThemeKind) |
| extension → webview | `init` | `{ worktree: string }` | Worktree path for inject script initialization |

The `postMessage(data)` method is safe to call before `resolveWebviewView` runs (it silently no-ops when `_view` is null).

### `src/views/inject.ts` — Webview injection script

**Key exports:** `const INJECT_SCRIPT: string`

**Dependencies:** None (browser-only; no Node.js APIs)

An async IIFE string that runs in the webview iframe context. Three sections:

**Section A — Theme CSS injection:**
- Defines `VSCODE_TO_OPENCODE` (V1 legacy tokens) and `V2_VSCODE_TO_OPENCODE` (V2 tokens) mapping tables
- `buildThemeCSS()` generates scoped CSS blocks for `html[data-color-scheme="dark"]` and `html[data-color-scheme="light"]`
- Listens for `themeChanged` postMessages; on receipt, removes old `<style>` and rebuilds
- Also injects derived tokens: diff colors, scrollbar styling, input/textarea/code block theming

**Section B — localStorage workspace isolation:**
- Computes a worktree hash via `crypto.subtle.digest('SHA-256')` (with DJB2 fallback)
- Intercepts `localStorage.setItem` / `getItem` to partition storage:
  - **Workspace-scoped keys** (`opencode.global.dat:*`, `opencode.window.browser.dat:*`) — persisted under `vsoc-workspace-{sha256}`
  - **Global keys** (`settings.v3`, `opencode-theme-id`) — stored normally (shared across workspaces)
  - **Temporary keys** — stored in a non-persistent `tempEnv` object (discarded on reload)

**Section C — Project sidebar seeding:**
- Enables new layout designs (`settings.v3` → `general.newLayoutDesigns = true`)
- Injects project info into `opencode.global.dat:server` (projects list, last project)
- Ensures tab storage entries exist (`opencode.window.browser.dat:tabs`, `tabs.info`, `tabs.recent`)

**Bootstrap:** Waits for worktree path (from `acquireVsCodeApi().getState()` or an `init` postMessage), then kicks off storage isolation and project seeding.

### `src/views/templates.ts` — HTML generators

**Key exports:** `getLoadingPageHtml(message)`, `getErrorPageHtml(message, canRetry)`

**Dependencies:** None

Generates complete HTML documents for the loading spinner and error pages. These use VS Code CSS variables (`--vscode-editor-background`, `--vscode-focusBorder`, etc.) and the `acquireVsCodeApi()` message API for the retry button. The `escapeHtml()` helper sanitizes user-provided text.

### `src/theme.ts` — Theme bridge

**Key exports:** `function setupThemeSync(context, postMessageToWebview)`

**Dependencies:** VS Code API

Subscribes to `vscode.window.onDidChangeActiveColorTheme`. Fires the current theme immediately on setup, then forwards every change as `{ type: 'themeChanged', kind: theme.kind }` to the webview via the provided `postMessageToWebview` callback. The callback is typically `ToolWebviewProvider.postMessage` bound to the provider instance.

### `src/commands/registerCommands.ts` — Command registration

**Key exports:** `function registerCommands(context)`

**Dependencies:** VS Code API

Registers two commands:

- `vscode-opencode.openToolWindow` — reveals the sidebar view container and shows an info message
- `vscode-opencode.refreshToolWindow` — placeholder for future wiring to `ServerController`

Each command's `Disposable` is pushed to `context.subscriptions`.

### `src/types.ts` — Type definitions

**Key exports:** `ConnectionState`, `HealthInfo`, `ServerInfo`, `SessionInfo`, `PathInfo`, `ProjectInfo`, `CreateSessionRequest`, `FileDiff`, `SessionSummary`, `ShareInfo`, `SessionTime`, `RevertInfo`, `ProjectTimeInfo`

**Dependencies:** None

TypeScript DTOs mirroring the OpenCode REST API response shapes. Includes a JSON key mapping table documenting PascalCase→camelCase transformations (`projectID` → `projectId`, `initialized` → `updated`, etc.).

### `src/utils/Logger.ts` — Output channel

**Key exports:** `class Logger` (implements `vscode.Disposable`), `const logger` (singleton)

Wraps `vscode.window.createOutputChannel('OpenCode', { log: true })` with timestamped `info()`, `warn()`, `error()` methods. The `{ log: true }` option ensures messages appear in the Output panel's drop-down.

### `src/utils/DisposableStore.ts` — Disposable aggregation

**Key exports:** `class DisposableStore` (implements `vscode.Disposable`)

Aggregates `Disposable` instances and disposes them in LIFO order. Provides `add()`, `disposeAll()`, and a static `from(...disposables)` factory. Safe to call `dispose()` multiple times.

### `src/utils/process.ts` — Process lifecycle

**Key exports:** `class ProcessRegistry`

Thread-safe registry of spawned child processes with platform-aware kill:

- **Windows:** `taskkill /pid <pid> /f /t` — force-kills the entire process tree
- **Unix:** `process.kill(-pid, 'SIGTERM')` — signals the process group (requires `detached: true` spawn)

Auto-removes entries when the process emits `exit`. `killAll()` terminates every registered process.

### `src/utils/path.ts` — Path utilities

**Key exports:** `normalizePath(p)`, `findGitRoot(startDir)`

- `normalizePath` — resolves to absolute, replaces backslashes with forward slashes
- `findGitRoot` — walks up from `startDir` until a `.git` file/directory is found; returns that directory or `null`

Both mirror their C# counterparts in `vs/Services/ProjectRootResolver.cs`.

---

## 6. Technology Decisions

### Why esbuild

The extension uses esbuild for bundling because:

- **Speed** — esbuild compiles the extension in milliseconds, making development iteration nearly instant
- **Zero-config for the common case** — the extension has no runtime npm dependencies, so tree-shaking and complex resolution aren't needed
- **Native `fetch`** — Node 18+ (required by VS Code ^1.85) ships with built-in `fetch`, eliminating the need for `node-fetch` or `axios`
- **Single-file output** — `dist/extension.js` is a self-contained CJS bundle; VS Code loads it directly
- **Watch mode** — esbuild's watch mode (via `ctx.watch()`) integrates cleanly with the VS Code Extension Development Host workflow
- **Optional webview bundle** — the esbuild config also bundles `src/webview/index.ts` → `dist/webview.js` (IIFE, browser target) if the entry point exists, keeping the door open for a more complex webview build later

### Why a local HTTP proxy

The VS Code webview runs with a unique opaque origin (`vscode-webview://...`). Loading the OpenCode UI directly from `http://127.0.0.1:4096` would fail because:

- **Origin mismatches** — the webview's CSP and CORS rules would block cross-origin requests
- **Cookie/storage isolation** — `localStorage` and cookies are bound to origin; a changing port or direct server access would break persistence
- **Content Security Policy** — the OpenCode server may send CSP headers incompatible with the webview context

The proxy solves this by:

1. Providing a **stable, predictable origin** (`http://127.0.0.1:{hash-based port}`) that persists across restarts
2. **Stripping CSP headers** so the page renders without restrictions inside the iframe
3. **Injecting the bridge script** (`/inject.js`) into HTML responses, hooking theme sync and storage isolation at page load
4. **Preserving SSE** — streamed responses pass through unbuffered
5. **Removing hop-by-hop headers** that don't belong in a proxy context

### Why object-literal dependency injection

The extension uses a plain `ServiceContainer` interface with direct construction rather than a DI framework:

- **Zero overhead** — no decorators, reflect-metadata, or IoC container runtime
- **Explicit wiring** — dependencies are visible in one place (`ExtensionController.activate()`)
- **No new dependency** — DI frameworks add npm dependencies and bundle size
- **Sufficient scale** — the extension has about a dozen services; a framework would be overkill
- **Testable** — services accept their dependencies in constructors; mock injection is straightforward

### Cross-platform approach

The extension runs on Windows, macOS, and Linux. Platform-specific handling:

| Concern | Approach |
|---|---|
| Process management | `ProcessRegistry` dispatches: `taskkill /f /t` (Windows) vs `process.kill(-pid, 'SIGTERM')` (Unix) |
| Binary resolution | `ServerService.resolveOpenCodePath()` checks AppData + ProgramFiles (Windows) vs /usr/local/bin + nvm (Unix) |
| Path normalization | `normalizePath()` resolves to absolute and replaces `\` with `/` |
| Shell commands | `where` (Windows) vs `which` (Unix) for PATH lookup |
| Process spawning | `detached: true` ensures the child becomes a process group leader on Unix for group-kill semantics |

---

## 7. OpenCode API Surface

The OpenCode server exposes a REST API. The following endpoints are consumed by the VS Code extension:

### Health

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/global/health` | Server health check. Returns `{ healthy: boolean, version?: string }`. Polled by `ServerService.checkHealth()` and `ConnectionMonitor`. |

### Session

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/session?directory={dir}` | List all sessions for a directory. Returns `SessionInfo[]`. Used by `ServerController.start()` to find existing sessions. |
| `POST` | `/session?directory={dir}` | Create a new session. Body: `{ title: string }`. Returns `SessionInfo`. Used when no existing session matches the project root. |
| `GET` | `/session/{id}/status` | Get session agent status. Returns `{ status: string }`. Polled by `ServerController.isAgentBusy()` for idle shutdown. |

### Path

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/path` | Get server path info. Returns `PathInfo { state?, config?, worktree?, directory? }`. Polled by `ServerController` for workspace mismatch detection. |
| `GET` | `/path?directory={dir}` | Get path info for a specific directory. Used by `SessionService.getPath()`. |

### Project

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/project?directory={dir}` | List all known projects for a directory. Returns `ProjectInfo[]`. Used by `SessionService.listProjects()`. |
| `GET` | `/project/current?directory={dir}` | Get current project info. Returns `ProjectInfo`. Used by `SessionService.getCurrentProject()`. |

### JSON key conventions

The server uses PascalCase for ID fields (`projectID`, `parentID`, `messageID`, `partID`) and `initialized` for project timestamps. `SessionService` maps these to camelCase TypeScript types (`projectId`, `parentId`, `messageId`, `partId`, `updated`). See `src/types.ts` for the full mapping table.

---

## Build & Package

### Build pipeline

```
src/extension.ts ──esbuild──▶ dist/extension.js   (CJS, Node, ES2022)
src/webview/index.ts ──esbuild──▶ dist/webview.js (IIFE, Browser, ES2022, optional)
```

**package.json scripts:**
- `npm run compile` — `node esbuild.config.js` (one-shot build)
- `npm run watch` — `node esbuild.config.js --watch` (continuous rebuild)
- `npm run package` — `vsce package --no-dependencies` (VSIX packaging)
- `npm run lint` — `biome check src/` (static analysis)

### Extension manifest (`package.json`)

| Field | Value | Notes |
|---|---|---|
| `name` | `vscode-opencode` | Extension identifier |
| `engines.vscode` | `^1.85.0` | Minimum VS Code version (Node 18+) |
| `main` | `./dist/extension.js` | Bundled entry point |
| `activationEvents` | `[]` | Lazy activation (triggers on command) |
| `contributes.viewsContainers` | Activity bar icon | `media/icon.svg` |
| `contributes.views` | Webview view `toolView` | Sidebar panel |
| `contributes.configuration` | `opencodePath`, `serverPort`, `idleTimeoutMinutes` | User settings |

### Localization

Strings in `package.json` use `%key%` tokens resolved from:

- `package.nls.json` — English (default)
- `package.nls.zh-cn.json` — Simplified Chinese

This mirrors the RESX satellite assembly pattern from the VS (C#) extension using VS Code's standard localization mechanism.
