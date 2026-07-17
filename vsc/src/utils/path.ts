import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolve `p` to an absolute path and replace backslashes with forward
 * slashes.  Mirrors {@link vs/Services/ProjectRootResolver.cs NormalizePath}.
 */
export function normalizePath(p: string): string {
	return path.resolve(p).replace(/\\/g, '/');
}

/**
 * Walk up from `startDir` until a `.git` file or directory is found,
 * then return that directory — the git repository root.
 *
 * Returns `null` if no `.git` is found before the filesystem root.
 *
 * Mirrors {@link vs/Services/ProjectRootResolver.cs FindGitRoot}.
 */
export function findGitRoot(startDir: string): string | null {
	let current = path.resolve(startDir);

	while (true) {
		const gitPath = path.join(current, '.git');
		try {
			const stat = fs.statSync(gitPath);
			if (stat.isDirectory() || stat.isFile()) {
				return current;
			}
		} catch {
			// .git does not exist at this level — walk up
		}

		const parent = path.dirname(current);
		if (parent === current) {
			break; // reached filesystem root
		}
		current = parent;
	}

	return null;
}
