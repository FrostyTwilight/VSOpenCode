import * as vscode from 'vscode';
import { DisposableStore } from './utils/DisposableStore';
import { Logger } from './utils/Logger';

// ---------------------------------------------------------------------------
// Service container — plain object, no DI framework needed.
// Services are added in later waves as they are built.
// ---------------------------------------------------------------------------

interface ServiceContainer {
	logger: Logger;
	// TODO (Wave 2): Add ServerService
	// TODO (Wave 2): Add SessionService
	// TODO (Wave 2): Add ProjectRootResolver
	// TODO (Wave 2): Add ConnectionMonitor
	// TODO (Wave 2): Add ServerController (orchestrator)
	// TODO (Wave 2): Add ProxyServer (local HTTP proxy)
}

// ---------------------------------------------------------------------------
// ExtensionController
// ---------------------------------------------------------------------------

/**
 * Owns the extension's entire lifecycle.
 *
 * Pattern mirrors `VSOpenCodePackage` in the VS extension (`vs/`):
 * a single orchestrator that wires up services, registers commands
 * and providers, and tears everything down on `deactivate()`.
 */
export class ExtensionController {
	private readonly context: vscode.ExtensionContext;
	private readonly disposables = new DisposableStore();

	private logger!: Logger;
	private services!: ServiceContainer;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	// -----------------------------------------------------------------------
	// activate
	// -----------------------------------------------------------------------

	/** Wire everything up. Called once by `extension.activate()`. */
	activate(): void {
		// (a) Create Logger — every service logs through it
		this.logger = new Logger();
		this.disposables.add(this.logger);
		this.logger.info('OpenCode extension activating…');

		// (b) Build service container (plain object — services added later)
		this.services = {
			logger: this.logger,
			// TODO (Wave 2): new ServerService(config, logger)
			// TODO (Wave 2): new SessionService(serverService, logger)
			// TODO (Wave 2): new ProjectRootResolver()
			// TODO (Wave 2): new ConnectionMonitor(serverService)
			// TODO (Wave 2): new ServerController(serverService, sessionService, ...)
			// TODO (Wave 2): new ProxyServer(serverController, logger)
		};

		// (c) Register commands
		this.registerCommands();

		// (d) Subscribe to workspace folder changes
		this.subscribeWorkspaceEvents();

		// (e) Push the DisposableStore to context.subscriptions
		//     VS Code will call dispose() on deactivation.
		this.context.subscriptions.push(this.disposables);

		// TODO (Wave 2): Initialize ServerController
		// TODO (Wave 2): Start proxy server
		// TODO (Wave 3): Register WebviewViewProvider for tool window
		// TODO (Wave 4): Set up theme sync (onDidChangeActiveColorTheme)

		this.logger.info('OpenCode extension activated.');
	}

	// -----------------------------------------------------------------------
	// deactivate
	// -----------------------------------------------------------------------

	/**
	 * Tear everything down.
	 *
	 * Returns a `Promise<void>` so VS Code can await it (5-second
	 * grace period). The DisposableStore is pushed to
	 * `context.subscriptions` which VS Code also disposes, but we
	 * explicitly dispose here for deterministic ordering.
	 */
	async deactivate(): Promise<void> {
		this.logger.info('OpenCode extension deactivating…');

		// TODO (Wave 2): Stop ServerController (kills opencode serve process)
		// TODO (Wave 2): Stop proxy server
		// TODO (Wave 2): Await ProcessRegistry cleanup (platform-aware kill)

		this.disposables.dispose();

		this.logger.info('OpenCode extension deactivated.');
	}

	// -----------------------------------------------------------------------
	// Internal wiring
	// -----------------------------------------------------------------------

	/**
	 * Register all commands declared in `package.json` → `contributes.commands`.
	 *
	 * For now only `vscode-opencode.openToolWindow` exists. Additional
	 * commands (refresh, settings, etc.) will be added in Wave 3.
	 */
	private registerCommands(): void {
		this.disposables.add(
			vscode.commands.registerCommand(
				'vscode-opencode.openToolWindow',
				() => {
					// TODO (Wave 3): Open the sidebar WebView — for now, a placeholder.
					void vscode.window.showInformationMessage(
						'OpenCode: Tool window coming soon',
					);
				},
			),
		);

		// TODO (Wave 3): vscode-opencode.refreshView
		// TODO (Wave 3): vscode-opencode.showLogs

		this.logger.info('Commands registered.');
	}

	/**
	 * Listen for workspace folder changes so we can re-resolve the
	 * project root and restart the server if needed.
	 */
	private subscribeWorkspaceEvents(): void {
		this.disposables.add(
			vscode.workspace.onDidChangeWorkspaceFolders((event) => {
				this.logger.info(
					`Workspace folders changed: added=${event.added.length}, removed=${event.removed.length}`,
				);

				// TODO (Wave 2): When ProjectRootResolver is available,
				//                re-resolve the project root and restart
				//                the server flow if the root changed.
			}),
		);

		this.logger.info('Workspace events subscribed.');
	}
}
