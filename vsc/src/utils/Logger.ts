import { window } from 'vscode';
import type { Disposable } from 'vscode';

/**
 * Wraps a VS Code {@link window.createOutputChannel OutputChannel} named
 * `"OpenCode"` with the `{ log: true }` option so messages also appear in
 * the Output panel's drop-down log.
 *
 * Every log method prepends an ISO-8601 timestamp.
 *
 * Implements `vscode.Disposable` so instances can be added to a
 * {@link DisposableStore} or pushed to `context.subscriptions`.
 */
export class Logger implements Disposable {
	private readonly _channel = window.createOutputChannel('OpenCode', {
		log: true,
	});

	/** Log an informational message. */
	info(msg: string): void {
		this._channel.appendLine(`[${new Date().toISOString()}] [INFO] ${msg}`);
	}

	/** Log a warning message. */
	warn(msg: string): void {
		this._channel.appendLine(`[${new Date().toISOString()}] [WARN] ${msg}`);
	}

	/** Log an error message. */
	error(msg: string): void {
		this._channel.appendLine(`[${new Date().toISOString()}] [ERROR] ${msg}`);
	}

	/** Dispose the underlying output channel. */
	dispose(): void {
		this._channel.dispose();
	}
}

/** Singleton logger instance for convenience. */
export const logger = new Logger();
