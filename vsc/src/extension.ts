import * as vscode from 'vscode';
import { ExtensionController } from './ExtensionController';

/**
 * Module-level controller reference.
 *
 * Stored here rather than in a class-static because VS Code's
 * `activate` / `deactivate` are plain function exports — there is
 * no class instance to hold it.
 */
let controller: ExtensionController | undefined;

/**
 * Called by VS Code when the extension is activated.
 *
 * The activation event is `onCommand:vscode-opencode.openToolWindow`
 * (declared in `package.json`), so this runs lazily when the user
 * first opens the tool window.
 */
export function activate(context: vscode.ExtensionContext): void {
	controller = new ExtensionController(context);
	controller.activate();
}

/**
 * Called by VS Code when the extension is deactivated or VS Code
 * itself is shutting down.
 *
 * **Must return `Promise<void>`** — VS Code waits up to 5 seconds
 * for this to resolve, giving us time to kill the `opencode serve`
 * process and clean up all resources.
 */
export async function deactivate(): Promise<void> {
	if (controller) {
		await controller.deactivate();
		controller = undefined;
	}
}
