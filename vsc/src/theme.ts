import * as vscode from 'vscode';

/**
 * Bridges VS Code theme changes to the webview.
 *
 * Subscribes to `onDidChangeActiveColorTheme`, posts a `themeChanged`
 * message with the numeric `ColorThemeKind` to the webview on every
 * change, and also fires the current theme immediately.
 */
export function setupThemeSync(
	context: vscode.ExtensionContext,
	postMessageToWebview: (data: unknown) => void,
): void {
	const sendTheme = (theme: vscode.ColorTheme): void => {
		postMessageToWebview({ type: 'themeChanged', kind: theme.kind });
	};

	// Fire initial theme immediately.
	sendTheme(vscode.window.activeColorTheme);

	// Subscribe to future changes.
	context.subscriptions.push(
		vscode.window.onDidChangeActiveColorTheme(sendTheme),
	);
}
