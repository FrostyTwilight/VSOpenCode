import * as vscode from 'vscode';

/**
 * Register all VS Code commands for the OpenCode extension.
 *
 * Each registered command returns a `Disposable` that is pushed to
 * `context.subscriptions` so VS Code cleans them up automatically
 * when the extension is deactivated.
 */
export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-opencode.openToolWindow', () => {
			vscode.commands.executeCommand('workbench.view.extension.vscode-opencode');
			vscode.window.showInformationMessage('OpenCode tool window opened.');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-opencode.refreshToolWindow', () => {
			// Placeholder — will be wired to ServerController in a later integration step.
			vscode.window.showInformationMessage('Refreshing OpenCode...');
		}),
	);
}
