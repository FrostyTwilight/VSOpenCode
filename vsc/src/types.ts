/**
 * OpenCode REST API — TypeScript DTO type definitions.
 *
 * ## JSON Key Mapping
 *
 * The OpenCode server sends JSON with different key conventions than
 * TypeScript camelCase. Use a mapping layer when deserializing:
 *
 * |       JSON key      |     TS property    | Notes                              |
 * |---------------------|--------------------|------------------------------------|
 * | `id`                | `id`               |                                    |
 * | `projectID`         | `projectId`        | PascalCase ID → camelCase Id       |
 * | `parentID`          | `parentId`         | PascalCase ID → camelCase Id       |
 * | `messageID`         | `messageId`        | PascalCase ID → camelCase Id       |
 * | `partID`            | `partId`           | PascalCase ID → camelCase Id       |
 * | `vcsDir`            | `vcsDir`           | Already camelCase                  |
 * | `file` (FileDiff)   | `path`             | Renamed for clarity                |
 * | `before` (FileDiff) | —                  | Not ported                         |
 * | `after` (FileDiff)  | —                  | Not ported                         |
 * | `initialized` (time)| `updated`          | Renamed for consistency            |
 */
// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Server connection lifecycle state.
 *
 * Mirrors {@link vs/Services/IOpenCodeServerService.cs ConnectionState}.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Response from `GET /global/health`.
 *
 * @see vs/Models/HealthInfo.cs
 */
export interface HealthInfo {
  /** Whether the server reports itself as healthy. */
  healthy: boolean;
  /** Server version string (may be omitted on error responses). */
  version?: string;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Server connection info — host and port for the OpenCode process.
 *
 * `baseUrl` is computed as `http://${host}:${port}` when
 * constructing the object.
 *
 * @see vs/Models/ServerInfo.cs
 */
export interface ServerInfo {
  /** Server hostname (default `127.0.0.1`). */
  host: string;
  /** Server port (default `4096`). */
  port: number;
  /** Full base URL (e.g. `http://127.0.0.1:4096`). Read-only once set. */
  readonly baseUrl: string;
}

// ---------------------------------------------------------------------------
// Session — shared sub-models
// ---------------------------------------------------------------------------

/**
 * Per-file diff summary returned inside {@link SessionSummary}.
 *
 * @see vs/Models/Session.cs FileDiff
 */
export interface FileDiff {
  /** Relative file path within the project. */
  path: string;
  /** Number of lines added in this file. */
  additions: number;
  /** Number of lines deleted in this file. */
  deletions: number;
}

/**
 * Aggregated session change summary.
 *
 * @see vs/Models/Session.cs SessionSummary
 */
export interface SessionSummary {
  /** Total lines added across all files. */
  additions: number;
  /** Total lines deleted across all files. */
  deletions: number;
  /** Number of files touched. */
  files: number;
  /** Per-file breakdown (may be omitted by server). */
  diffs?: FileDiff[];
}

/**
 * Share information for a published session.
 *
 * @see vs/Models/Session.cs ShareInfo
 */
export interface ShareInfo {
  /** Public share URL (present when session has been shared). */
  url?: string;
}

/**
 * Session timestamp info.
 *
 * @see vs/Models/Session.cs SessionTime
 */
export interface SessionTime {
  /** ISO-8601 creation timestamp. */
  created?: string;
  /** ISO-8601 last-update timestamp. */
  updated?: string;
  /** Whether the session is currently being compacted. */
  compacting?: boolean;
}

/**
 * Revert/snapshot info for undoing messages.
 *
 * @see vs/Models/Session.cs RevertInfo
 */
export interface RevertInfo {
  /** ID of the message that can be reverted. */
  messageId?: string;
  /** ID of the specific message part. */
  partId?: string;
  /** File snapshot before the change. */
  snapshot?: string;
  /** Diff content to revert. */
  diff?: string;
}

// ---------------------------------------------------------------------------
// Session — top-level
// ---------------------------------------------------------------------------

/**
 * Full session object returned by `GET /session` and `POST /session`.
 *
 * @see vs/Models/Session.cs Session
 */
export interface SessionInfo {
  /** Unique session identifier. */
  id: string;
  /** Project this session belongs to. */
  projectId?: string;
  /** Working directory for this session. */
  directory?: string;
  /** Parent session ID (for continuation sessions). */
  parentId?: string;
  /** Human-readable session title. */
  title?: string;
  /** OpenCode version that created this session. */
  version?: string;
  /** Aggregated change summary. */
  summary?: SessionSummary;
  /** Share info (when session is published). */
  share?: ShareInfo;
  /** Timestamps. */
  time?: SessionTime;
  /** Revert information. */
  revert?: RevertInfo;
}

/**
 * Request body for `POST /session` (create a new session).
 *
 * @see vs/Models/Session.cs CreateSessionRequest
 */
export interface CreateSessionRequest {
  /** Parent session ID for continuing an existing session. */
  parentId?: string;
  /** Title for the new session (required). */
  title: string;
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

/**
 * Path / directory information from `GET /path`.
 *
 * @see vs/Models/PathInfo.cs
 */
export interface PathInfo {
  /** Path to the OpenCode state file/directory. */
  state?: string;
  /** Path to the OpenCode configuration file. */
  config?: string;
  /** Path to the git worktree root. */
  worktree?: string;
  /** Current working directory for the OpenCode process. */
  directory?: string;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * Project timestamp info.
 *
 * @see vs/Models/ProjectInfo.cs ProjectTimeInfo
 */
export interface ProjectTimeInfo {
  /** ISO-8601 creation timestamp. */
  created?: string;
  /** ISO-8601 last-update timestamp (maps to JSON key `initialized`). */
  updated?: string;
}

/**
 * Project info from `GET /project` or `GET /project/current`.
 *
 * @see vs/Models/ProjectInfo.cs
 */
export interface ProjectInfo {
  /** Unique project identifier. */
  id: string;
  /** Git worktree root path. */
  worktree?: string;
  /** VCS metadata directory (e.g. `.git`). */
  vcsDir?: string;
  /** VCS name (e.g. `git`). */
  vcs?: string;
  /** Project timestamps. */
  time?: ProjectTimeInfo;
}
