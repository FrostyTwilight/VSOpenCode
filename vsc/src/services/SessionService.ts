import type {
  SessionInfo,
  SessionSummary,
  SessionTime,
  ShareInfo,
  RevertInfo,
  FileDiff,
  PathInfo,
  ProjectInfo,
  ProjectTimeInfo,
} from '../types';

// ---------------------------------------------------------------------------
// JSON → TS key mapping helpers
//
// The OpenCode server uses PascalCase keys for ID fields:
//   projectID → projectId, parentID → parentId, etc.
//
// The server also uses `initialized` for project timestamps, which we map
// to `updated` in our ProjectTimeInfo type.
// ---------------------------------------------------------------------------

/** Raw server JSON shape for a session (PascalCase ID keys). */
interface ServerSession {
  id: string;
  projectID?: string;
  parentID?: string;
  directory?: string;
  title?: string;
  version?: string;
  summary?: ServerSessionSummary;
  share?: ServerShareInfo;
  time?: ServerSessionTime;
  revert?: ServerRevertInfo;
}

interface ServerSessionSummary {
  additions: number;
  deletions: number;
  files: number;
  diffs?: ServerFileDiff[];
}

interface ServerFileDiff {
  file: string;
  additions: number;
  deletions: number;
}

interface ServerShareInfo {
  url?: string;
}

interface ServerSessionTime {
  created?: string;
  updated?: string;
  compacting?: boolean;
}

interface ServerRevertInfo {
  messageID?: string;
  partID?: string;
  snapshot?: string;
  diff?: string;
}

/** Raw server JSON shape for a project (PascalCase ID keys, `initialized` timestamp). */
interface ServerProject {
  id: string;
  worktree?: string;
  vcsDir?: string;
  vcs?: string;
  time?: ServerProjectTime;
}

interface ServerProjectTime {
  created?: string;
  initialized?: string;
}

/** Raw server JSON shape for path info. */
interface ServerPath {
  state?: string;
  config?: string;
  worktree?: string;
  directory?: string;
}

// ---------------------------------------------------------------------------
// Mapping functions
//
// The OpenCode server uses PascalCase keys (projectID, parentID, messageID,
// partID) plus `initialized` for project timestamps.  These mappers convert
// those to the camelCase TypeScript types in `../types`.
//
// Because the project enables `exactOptionalPropertyTypes`, each return
// value is asserted to its target type — the spread operators with
// `&& { key: val }` ensure optional sub-objects are only included when
// present, while top-level optional fields (`?: string`) use `as` to pass
// the strictness check.  The runtime shapes are correct; this is purely a
// compile-time noise issue at the mapping boundary.
// ---------------------------------------------------------------------------

function mapFileDiff(raw: ServerFileDiff): FileDiff {
  return {
    path: raw.file,
    additions: raw.additions,
    deletions: raw.deletions,
  };
}

function mapSessionSummary(raw: ServerSessionSummary): SessionSummary {
  const diffs = raw.diffs?.map(mapFileDiff);
  return {
    additions: raw.additions,
    deletions: raw.deletions,
    files: raw.files,
    ...(diffs !== undefined ? { diffs } : {}),
  } as SessionSummary;
}

function mapShareInfo(raw: ServerShareInfo): ShareInfo {
  return { url: raw.url } as ShareInfo;
}

function mapSessionTime(raw: ServerSessionTime): SessionTime {
  return {
    created: raw.created,
    updated: raw.updated,
    compacting: raw.compacting,
  } as SessionTime;
}

function mapRevertInfo(raw: ServerRevertInfo): RevertInfo {
  return {
    messageId: raw.messageID,
    partId: raw.partID,
    snapshot: raw.snapshot,
    diff: raw.diff,
  } as RevertInfo;
}

function mapSession(raw: ServerSession): SessionInfo {
  return {
    id: raw.id,
    projectId: raw.projectID,
    parentId: raw.parentID,
    directory: raw.directory,
    title: raw.title,
    version: raw.version,
    ...(raw.summary ? { summary: mapSessionSummary(raw.summary) } : {}),
    ...(raw.share ? { share: mapShareInfo(raw.share) } : {}),
    ...(raw.time ? { time: mapSessionTime(raw.time) } : {}),
    ...(raw.revert ? { revert: mapRevertInfo(raw.revert) } : {}),
  } as SessionInfo;
}

function mapProjectTime(raw: ServerProjectTime): ProjectTimeInfo {
  return {
    created: raw.created,
    updated: raw.initialized,
  } as ProjectTimeInfo;
}

function mapProject(raw: ServerProject): ProjectInfo {
  return {
    id: raw.id,
    worktree: raw.worktree,
    vcsDir: raw.vcsDir,
    vcs: raw.vcs,
    ...(raw.time ? { time: mapProjectTime(raw.time) } : {}),
  } as ProjectInfo;
}

function mapPath(raw: ServerPath): PathInfo {
  return {
    state: raw.state,
    config: raw.config,
    worktree: raw.worktree,
    directory: raw.directory,
  } as PathInfo;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An error thrown when the HTTP response is an error status. */
export class SessionServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

// ---------------------------------------------------------------------------
// SessionService
// ---------------------------------------------------------------------------

/**
 * Typed REST client for the OpenCode HTTP API.
 *
 * Wraps {@link fetch} to call the OpenCode server. All methods throw
 * {@link SessionServiceError} when the server responds with a non-2xx status.
 */
export class SessionService {
  private readonly baseUrl: string;

  /**
   * @param baseUrl — full base URL of the OpenCode server,
   *   e.g. `http://localhost:4096`.
   */
  constructor(baseUrl: string) {
    // Strip trailing slash for consistent URL concatenation
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------

  /**
   * List all sessions for a given directory.
   *
   * Calls `GET /session?directory={dir}`.
   */
  async listSessions(directory: string): Promise<SessionInfo[]> {
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, 'listSessions');
    const data: ServerSession[] = await response.json();
    return data.map(mapSession);
  }

  /**
   * Create a new session in the given directory.
   *
   * Calls `POST /session?directory={dir}` with a JSON body
   * `{ title }`.
   */
  async createSession(
    directory: string,
    title = 'VS Code OpenCode',
  ): Promise<SessionInfo> {
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await this.assertOk(response, 'createSession');
    const data: ServerSession = await response.json();
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
  async getPath(directory: string): Promise<PathInfo> {
    const url = `${this.baseUrl}/path?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, 'getPath');
    const data: ServerPath = await response.json();
    return mapPath(data);
  }

  /**
   * Get the server's own path information (no directory filter).
   *
   * Calls `GET /path`.
   */
  async getServerPath(): Promise<PathInfo> {
    const url = `${this.baseUrl}/path`;
    const response = await fetch(url);
    await this.assertOk(response, 'getServerPath');
    const data: ServerPath = await response.json();
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
  async listProjects(directory: string): Promise<ProjectInfo[]> {
    const url = `${this.baseUrl}/project?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, 'listProjects');
    const data: ServerProject[] = await response.json();
    return data.map(mapProject);
  }

  /**
   * Get the current project info for a given directory.
   *
   * Calls `GET /project/current?directory={dir}`.
   */
  async getCurrentProject(directory: string): Promise<ProjectInfo> {
    const url = `${this.baseUrl}/project/current?directory=${encodeURIComponent(directory)}`;
    const response = await fetch(url);
    await this.assertOk(response, 'getCurrentProject');
    const data: ServerProject = await response.json();
    return mapProject(data);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async assertOk(
    response: Response,
    method: string,
  ): Promise<void> {
    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        // ignore — body may be unreadable
      }
      throw new SessionServiceError(
        `${method} failed with ${response.status}: ${body}`,
        response.status,
      );
    }
  }
}
