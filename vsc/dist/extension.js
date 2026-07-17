"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = require("vscode");

// src/ExtensionController.ts
var vscode = __toESM(require("vscode"));

// src/utils/DisposableStore.ts
var DisposableStore = class _DisposableStore {
  _disposables = [];
  /** Register a disposable to be disposed later. */
  add(disposable) {
    this._disposables.push(disposable);
  }
  /**
   * Dispose all registered disposables in reverse order and clear the
   * store. Safe to call multiple times.
   */
  dispose() {
    this.disposeAll();
  }
  /** Same as dispose() — disposes all registrations in LIFO order. */
  disposeAll() {
    while (this._disposables.length > 0) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
  /**
   * Convenience factory that creates a `DisposableStore` pre-populated
   * with the given disposables.
   */
  static from(...disposables) {
    const store = new _DisposableStore();
    for (const d of disposables) {
      store.add(d);
    }
    return store;
  }
};

// src/utils/Logger.ts
var import_vscode = require("vscode");
var Logger = class {
  _channel = import_vscode.window.createOutputChannel("OpenCode", {
    log: true
  });
  /** Log an informational message. */
  info(msg) {
    this._channel.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] [INFO] ${msg}`);
  }
  /** Log a warning message. */
  warn(msg) {
    this._channel.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] [WARN] ${msg}`);
  }
  /** Log an error message. */
  error(msg) {
    this._channel.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] [ERROR] ${msg}`);
  }
  /** Dispose the underlying output channel. */
  dispose() {
    this._channel.dispose();
  }
};
var logger = new Logger();

// src/ExtensionController.ts
var ExtensionController = class {
  context;
  disposables = new DisposableStore();
  logger;
  services;
  constructor(context) {
    this.context = context;
  }
  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------
  /** Wire everything up. Called once by `extension.activate()`. */
  activate() {
    this.logger = new Logger();
    this.disposables.add(this.logger);
    this.logger.info("OpenCode extension activating\u2026");
    this.services = {
      logger: this.logger
      // TODO (Wave 2): new ServerService(config, logger)
      // TODO (Wave 2): new SessionService(serverService, logger)
      // TODO (Wave 2): new ProjectRootResolver()
      // TODO (Wave 2): new ConnectionMonitor(serverService)
      // TODO (Wave 2): new ServerController(serverService, sessionService, ...)
      // TODO (Wave 2): new ProxyServer(serverController, logger)
    };
    this.registerCommands();
    this.subscribeWorkspaceEvents();
    this.context.subscriptions.push(this.disposables);
    this.logger.info("OpenCode extension activated.");
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
  async deactivate() {
    this.logger.info("OpenCode extension deactivating\u2026");
    this.disposables.dispose();
    this.logger.info("OpenCode extension deactivated.");
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
  registerCommands() {
    this.disposables.add(
      vscode.commands.registerCommand(
        "vscode-opencode.openToolWindow",
        () => {
          void vscode.window.showInformationMessage(
            "OpenCode: Tool window coming soon"
          );
        }
      )
    );
    this.logger.info("Commands registered.");
  }
  /**
   * Listen for workspace folder changes so we can re-resolve the
   * project root and restart the server if needed.
   */
  subscribeWorkspaceEvents() {
    this.disposables.add(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        this.logger.info(
          `Workspace folders changed: added=${event.added.length}, removed=${event.removed.length}`
        );
      })
    );
    this.logger.info("Workspace events subscribed.");
  }
};

// src/extension.ts
var controller;
function activate(context) {
  controller = new ExtensionController(context);
  controller.activate();
}
async function deactivate() {
  if (controller) {
    await controller.deactivate();
    controller = void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
