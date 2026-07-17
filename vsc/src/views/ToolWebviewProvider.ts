import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// ToolWebviewProvider
// ---------------------------------------------------------------------------

/**
 * {@link vscode.WebviewViewProvider} that manages the OpenCode tool window
 * in the VS Code sidebar.
 *
 * ## HTML lifecycle
 *
 * The webview cycles through three inline HTML pages:
 * 1. **Loading** — spinner + message (set during {@link resolveWebviewView}
 *    and via {@link showLoading}).
 * 2. **Iframe** — full-viewport iframe pointing at the local proxy server
 *    (set via {@link navigateToSession}).
 * 3. **Error** — error message with optional retry button (set via
 *    {@link showError}).
 *
 * Template extraction to separate files is deferred (see todo #13).
 *
 * ## Message protocol
 *
 * | Direction     | Type    | Payload | Purpose                          |
 * |---------------|---------|---------|----------------------------------|
 * | webview → ext | `retry` | —       | User clicked the retry button    |
 * | webview → ext | `ready` | —       | Session iframe finished loading  |
 */
export class ToolWebviewProvider implements vscode.WebviewViewProvider {
	// -----------------------------------------------------------------------
	// Fields
	// -----------------------------------------------------------------------

	private _view: vscode.WebviewView | null = null;
	private readonly _extensionUri: vscode.Uri;
	private readonly _getProxyUrl: () => string;

	private readonly _onDidRequestRetry = new vscode.EventEmitter<void>();
	/** Fires when the user clicks the retry button on the error page. */
	readonly onDidRequestRetry = this._onDidRequestRetry.event;

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
	constructor(extensionUri: vscode.Uri, getProxyUrl: () => string) {
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
	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			retainContextWhenHidden: true,
		} as vscode.WebviewOptions;

		// Show the loading spinner until navigateToSession() is called.
		this.showLoading("Starting OpenCode\u2026");

		// Listen for messages from the webview.
		webviewView.webview.onDidReceiveMessage(
			(message: Record<string, unknown>) => {
				switch (message.type) {
					case "retry":
						this._onDidRequestRetry.fire();
						break;
					// 'ready' is informational — no action needed.
				}
			},
		);
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
	navigateToSession(sessionUrl: string): void {
		if (!this._view) {
			return;
		}
		const proxyUrl = this._getProxyUrl();
		const src = sessionUrl.startsWith("/")
			? `${proxyUrl}${sessionUrl}`
			: `${proxyUrl}/${sessionUrl}`;
		this._view.webview.html = this._buildIframeHtml(src);
	}

	/**
	 * Show a loading spinner with a message.
	 */
	showLoading(message: string): void {
		if (!this._view) {
			return;
		}
		this._view.webview.html = this._buildLoadingHtml(message);
	}

	/**
	 * Show an error display.
	 *
	 * @param message Human-readable error description.
	 * @param canRetry When `true`, a retry button is rendered that fires
	 *   {@link onDidRequestRetry} when clicked.
	 */
	showError(message: string, canRetry: boolean): void {
		if (!this._view) {
			return;
		}
		this._view.webview.html = this._buildErrorHtml(message, canRetry);
	}

	/**
	 * Send an arbitrary message to the webview.
	 *
	 * Safe to call before {@link resolveWebviewView} — silently no-ops
	 * when `_view` is null.
	 */
	postMessage(data: unknown): void {
		this._view?.webview.postMessage(data);
	}

	// -----------------------------------------------------------------------
	// Cleanup
	// -----------------------------------------------------------------------

	/**
	 * Dispose the retry event emitter and clear the view reference.
	 * Called by the extension controller on deactivation.
	 */
	dispose(): void {
		this._onDidRequestRetry.dispose();
		this._view = null;
	}

	// -----------------------------------------------------------------------
	// HTML builders (inline — templates will be extracted in todo #13)
	// -----------------------------------------------------------------------

	/**
	 * Full-viewport iframe that loads the session through the proxy.
	 * Posts a `{ type: 'ready' }` message when the iframe finishes loading.
	 */
	private _buildIframeHtml(src: string): string {
		return [
			"<!DOCTYPE html>",
			'<html lang="en">',
			"<head>",
			'<meta charset="UTF-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
			"<title>OpenCode</title>",
			"<style>",
			"  *{margin:0;padding:0;box-sizing:border-box}",
			"  html,body{width:100%;height:100%;overflow:hidden;",
			"background:var(--vscode-editor-background,#1e1e1e)}",
			"  iframe{width:100%;height:100%;border:none}",
			"</style>",
			"</head>",
			"<body>",
			`<iframe src="${this._escapeAttr(src)}"></iframe>`,
			"<script>",
			"  const vscode = acquireVsCodeApi();",
			"  const iframe = document.querySelector('iframe');",
			"  iframe.addEventListener('load', () => {",
			"    vscode.postMessage({ type: 'ready' });",
			"  });",
			"</script>",
			"</body>",
			"</html>",
		].join("\n");
	}

	/**
	 * Centered CSS spinner with a message underneath.
	 */
	private _buildLoadingHtml(message: string): string {
		return [
			"<!DOCTYPE html>",
			'<html lang="en">',
			"<head>",
			'<meta charset="UTF-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
			"<title>OpenCode</title>",
			"<style>",
			"  *{margin:0;padding:0;box-sizing:border-box}",
			"  body{display:flex;align-items:center;justify-content:center;",
			"min-height:100vh;",
			"background:var(--vscode-editor-background,#1e1e1e);",
			"color:var(--vscode-editor-foreground,#d4d4d4);",
			"font-family:var(--vscode-font-family,-apple-system,sans-serif)}",
			"  .spinner{width:40px;height:40px;",
			"border:3px solid var(--vscode-editorWidget-border,#3c3c3c);",
			"border-top-color:var(--vscode-focusBorder,#007acc);",
			"border-radius:50%;animation:spin .8s linear infinite}",
			"  @keyframes spin{to{transform:rotate(360deg)}}",
			"  .container{text-align:center}",
			"  .container p{margin-top:16px;font-size:14px;opacity:.8}",
			"</style>",
			"</head>",
			"<body>",
			'<div class="container">',
			'  <div class="spinner"></div>',
			`  <p>${this._escapeHtml(message)}</p>`,
			"</div>",
			"</body>",
			"</html>",
		].join("\n");
	}

	/**
	 * Error display with an optional retry button.
	 * Posts a `{ type: 'retry' }` message when the button is clicked.
	 */
	private _buildErrorHtml(message: string, canRetry: boolean): string {
		const retryButton = canRetry
			? '<button id="retry-btn">Retry</button>'
			: "";

		return [
			"<!DOCTYPE html>",
			'<html lang="en">',
			"<head>",
			'<meta charset="UTF-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
			"<title>OpenCode — Error</title>",
			"<style>",
			"  *{margin:0;padding:0;box-sizing:border-box}",
			"  body{display:flex;align-items:center;justify-content:center;",
			"min-height:100vh;",
			"background:var(--vscode-editor-background,#1e1e1e);",
			"color:var(--vscode-editor-foreground,#d4d4d4);",
			"font-family:var(--vscode-font-family,-apple-system,sans-serif)}",
			"  .container{text-align:center;max-width:320px;padding:24px}",
			"  .error-icon{font-size:48px;line-height:1;margin-bottom:16px}",
			"  .container p{margin-bottom:24px;font-size:14px;",
			"line-height:1.5;opacity:.85;word-wrap:break-word}",
			"  button{background:var(--vscode-button-background,#007acc);",
			"color:var(--vscode-button-foreground,#fff);",
			"border:none;padding:8px 24px;font-size:13px;",
			"border-radius:2px;cursor:pointer}",
			"  button:hover{background:var(--vscode-button-hoverBackground,#1c97e8)}",
			"</style>",
			"</head>",
			"<body>",
			'<div class="container">',
			'  <div class="error-icon">\u26A0\uFE0F</div>',
			`  <p>${this._escapeHtml(message)}</p>`,
			`  ${retryButton}`,
			"</div>",
			canRetry
				? [
						"<script>",
						"  const vscode = acquireVsCodeApi();",
						"  document.getElementById('retry-btn').addEventListener('click', () => {",
						"    vscode.postMessage({ type: 'retry' });",
						"  });",
						"</script>",
					].join("\n")
				: "",
			"</body>",
			"</html>",
		].join("\n");
	}

	// -----------------------------------------------------------------------
	// Escaping helpers
	// -----------------------------------------------------------------------

	/**
	 * Escape a string for safe inclusion in HTML text content.
	 */
	private _escapeHtml(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	/**
	 * Escape a string for safe inclusion in an HTML attribute value
	 * (double-quoted).
	 */
	private _escapeAttr(value: string): string {
		return value
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}
}
