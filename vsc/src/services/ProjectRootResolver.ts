import * as os from 'os';
import * as vscode from 'vscode';
import { normalizePath, findGitRoot } from '../utils/path';

/**
 * Resolves the project/workspace root directory.
 *
 * Mirrors {@link vs/Services/ProjectRootResolver.cs}.
 */
export class ProjectRootResolver {
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
	resolve(): string {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspaceFolder) {
			return normalizePath(workspaceFolder);
		}

		const gitRoot = findGitRoot(workspaceFolder ?? os.homedir());
		if (gitRoot) {
			return normalizePath(gitRoot);
		}

		return normalizePath(os.homedir());
	}
}
