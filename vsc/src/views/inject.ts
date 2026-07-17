/**
 * Webview injection script — theme CSS, localStorage isolation, and
 * project sidebar setup.
 *
 * Ported from `vs/Resources/Inject.js` and adapted for VS Code:
 *   - Reads theme colours from `--vscode-*` CSS variables (already
 *     injected by VS Code into every webview) instead of a WebView2
 *     COM bridge.
 *   - Gets the worktree path from `acquireVsCodeApi().getState()` (or
 *     an initial postMessage) instead of a C# host object.
 *   - Computes SHA-256 in the browser via SubtleCrypto (with a DJB2
 *     32-bit fallback) instead of using a pre-computed C# hash.
 *
 * The exported string is an async IIFE that runs in the webview
 * context — **no Node.js APIs**.
 */

export const INJECT_SCRIPT = `\
(async function () {
'use strict';

// =========================================================================
// Section A — Theme CSS injection
// =========================================================================

var VSCODE_TO_OPENCODE = {
	// -- backgrounds
	'--vscode-editor-background':             '--background-base',
	'--vscode-sideBar-background':            '--background-weak',
	'--vscode-editor-background':             '--background-strong',
	'--vscode-editorWidget-background':       '--background-stronger',
	// -- surfaces
	'--vscode-sideBar-background':            '--surface-raised-strong',
	'--vscode-editorWidget-background':       '--surface-raised-stronger',
	// -- text
	'--vscode-editor-foreground':             '--text-strong',
	'--vscode-descriptionForeground':         '--text-base',
	'--vscode-descriptionForeground':         '--text-weak',
	'--vscode-textLink-foreground':           '--text-interactive-base',
	'--vscode-textLink-activeForeground':     '--text-interactive-hover',
	// -- inputs
	'--vscode-input-background':              '--input-base',
	'--vscode-editor-background':             '--input-focus',
	// -- buttons
	'--vscode-button-background':             '--button-primary-base',
	'--vscode-button-foreground':             '--button-primary-text',
	'--vscode-button-secondaryBackground':    '--button-secondary-base',
	'--vscode-button-secondaryForeground':    '--button-secondary-text',
	// -- borders
	'--vscode-panel-border':                  '--border-base',
	'--vscode-input-border':                  '--border-strong',
	'--vscode-focusBorder':                   '--border-selected',
	'--vscode-editorWidget-background':       '--border-weak-base',
	// -- icons
	'--vscode-icon-foreground':               '--icon-base',
	'--vscode-editor-foreground':             '--icon-hover',
	'--vscode-editor-foreground':             '--icon-active',
	'--vscode-editor-background':             '--icon-invert-base',
	// -- markdown
	'--vscode-textLink-foreground':           '--markdown-heading',
	'--vscode-editor-foreground':             '--markdown-text',
	'--vscode-textLink-activeForeground':     '--markdown-link',
	'--vscode-descriptionForeground':         '--markdown-code',
	'--vscode-editor-foreground':             '--markdown-block-quote',
};

var V2_VSCODE_TO_OPENCODE = {
	// -- backgrounds
	'--vscode-editor-background':             '--v2-background-bg-base',
	'--vscode-editor-background':             '--v2-background-bg-deep',
	'--vscode-sideBar-background':            '--v2-background-bg-layer-01',
	'--vscode-editorWidget-background':       '--v2-background-bg-layer-02',
	'--vscode-list-hoverBackground':          '--v2-background-bg-layer-03',
	'--vscode-editor-foreground':             '--v2-background-bg-inverse',
	'--vscode-input-background':              '--v2-background-bg-contrast',
	'--vscode-focusBorder':                   '--v2-background-bg-accent',
	// -- text
	'--vscode-editor-foreground':             '--v2-text-text-base',
	'--vscode-descriptionForeground':         '--v2-text-text-muted',
	'--vscode-descriptionForeground':         '--v2-text-text-faint',
	'--vscode-textLink-foreground':           '--v2-text-text-accent',
	'--vscode-textLink-activeForeground':     '--v2-text-text-accent-hover',
	'--vscode-editor-background':             '--v2-text-text-inverse',
	// -- icons
	'--vscode-icon-foreground':               '--v2-icon-icon-base',
	'--vscode-textLink-foreground':           '--v2-icon-icon-accent',
	// -- borders
	'--vscode-panel-border':                  '--v2-border-border-muted',
	'--vscode-panel-border':                  '--v2-border-border-base',
	'--vscode-input-border':                  '--v2-border-border-strong',
	'--vscode-focusBorder':                   '--v2-border-border-focus',
};

function buildThemeCSS() {
	var lines = [];

	// Helper: emit a CSS block scoped to [data-color-scheme]
	function block(selector) {
		lines.push(selector + ' {');

		// Legacy tokens
		var seen = {};
		Object.keys(VSCODE_TO_OPENCODE).forEach(function (vscVar) {
			var openCodeVar = VSCODE_TO_OPENCODE[vscVar];
			if (seen[openCodeVar]) return;
			seen[openCodeVar] = true;
			lines.push('  ' + openCodeVar + ': var(' + vscVar + ');');
		});

		// Derived tokens that cannot be mapped 1:1 — use VSCode
		// variable references where possible, fallback otherwise
		lines.push('  --surface-base: transparent;');
		lines.push('  --text-weaker: var(--vscode-descriptionForeground);');
		lines.push('  --text-diff-add-base: #4ec9b0;');
		lines.push('  --text-diff-delete-base: #f14c4c;');
		lines.push('  --surface-diff-add-base: rgba(78,201,176,0.15);');
		lines.push('  --surface-diff-delete-base: rgba(241,76,76,0.15);');
		lines.push('  --scrollbar-base: var(--vscode-scrollbarSlider-background, #686868);');
		lines.push('  --scrollbar-hover: var(--vscode-scrollbarSlider-hoverBackground, var(--vscode-scrollbarSlider-background, #686868));');

		lines.push('}');

		// V2 tokens
		lines.push(selector + ' {');
		var seenV2 = {};
		Object.keys(V2_VSCODE_TO_OPENCODE).forEach(function (vscVar) {
			var openCodeVar = V2_VSCODE_TO_OPENCODE[vscVar];
			if (seenV2[openCodeVar]) return;
			seenV2[openCodeVar] = true;
			lines.push('  ' + openCodeVar + ': var(' + vscVar + ');');
		});

		// State tokens — hardcoded VS-like palette
		lines.push('  --v2-state-bg-success: rgba(78,201,176,0.15);');
		lines.push('  --v2-state-fg-success: #4ec9b0;');
		lines.push('  --v2-state-bg-danger: rgba(241,76,76,0.15);');
		lines.push('  --v2-state-fg-danger: #f14c4c;');
		lines.push('  --v2-state-bg-warning: rgba(204,167,0,0.15);');
		lines.push('  --v2-state-fg-warning: #cca700;');
		lines.push('  --v2-state-bg-info: rgba(0,122,204,0.15);');
		lines.push('  --v2-state-fg-info: var(--vscode-focusBorder, #007acc);');

		lines.push('}');

		// Body
		lines.push(selector + ' body {');
		lines.push('  background-color: var(--vscode-editor-background);');
		lines.push('  color: var(--vscode-editor-foreground);');
		lines.push('}');

		// Scrollbar
		lines.push(selector + ' ::-webkit-scrollbar { width:10px; height:10px; }');
		lines.push(selector + ' ::-webkit-scrollbar-track { background:transparent; }');
		lines.push(selector + ' ::-webkit-scrollbar-thumb {');
		lines.push('  background: var(--vscode-scrollbarSlider-background, #686868);');
		lines.push('  border-radius:5px;');
		lines.push('}');
		lines.push(selector + ' ::-webkit-scrollbar-thumb:hover {');
		lines.push('  background: var(--vscode-scrollbarSlider-hoverBackground, var(--vscode-scrollbarSlider-background, #686868));');
		lines.push('}');
		lines.push(selector + ' ::-webkit-scrollbar-corner { background:transparent; }');

		// Inputs
		lines.push(selector + ' input,');
		lines.push(selector + ' textarea {');
		lines.push('  background-color: var(--vscode-input-background);');
		lines.push('  color: var(--vscode-editor-foreground);');
		lines.push('  border-color: var(--vscode-input-border, var(--vscode-panel-border));');
		lines.push('}');
		lines.push(selector + ' input::placeholder,');
		lines.push(selector + ' textarea::placeholder {');
		lines.push('  color: var(--vscode-descriptionForeground);');
		lines.push('}');

		// Code blocks
		lines.push(selector + ' pre,');
		lines.push(selector + ' code {');
		lines.push('  background-color: var(--vscode-editorWidget-background);');
		lines.push('  color: var(--vscode-editor-foreground);');
		lines.push('}');
	}

	block('html[data-color-scheme="dark"]');
	block('html[data-color-scheme="light"]');

	return lines.join('\\n');
}

function tryInjectThemeCSS() {
	if (document.getElementById('vscode-theme-inject')) return;

	var css = buildThemeCSS();
	if (!css) return;

	var style = document.createElement('style');
	style.id = 'vscode-theme-inject';
	style.textContent = css;

	if (document.head) {
		document.head.appendChild(style);
	}
}

// Listen for theme-change messages from the extension host
window.addEventListener('message', function (event) {
	var msg = event.data;
	if (msg && msg.type === 'themeChanged') {
		var old = document.getElementById('vscode-theme-inject');
		if (old) old.remove();
		tryInjectThemeCSS();
	}
});

// Inject theme CSS as soon as the DOM is ready
if (document.head && document.readyState !== 'loading') {
	tryInjectThemeCSS();
} else {
	document.addEventListener('DOMContentLoaded', tryInjectThemeCSS);
}

// =========================================================================
// Section B — localStorage workspace isolation
// =========================================================================

// ----- SHA-256 (SubtleCrypto) + DJB2 fallback -----

function djb2(str) {
	var hash = 5381;
	for (var i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
		hash = hash & hash; // force 32-bit
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

async function sha256(message) {
	try {
		if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
			var encoder = new TextEncoder();
			var data = encoder.encode(message);
			var hashBuffer = await crypto.subtle.digest('SHA-256', data);
			var hashArray = Array.from(new Uint8Array(hashBuffer));
			return hashArray.map(function (b) {
				return b.toString(16).padStart(2, '0');
			}).join('');
		}
	} catch (_) { /* fall through to fallback */ }
	return djb2(message);
}

// ----- Acquire worktree path -----

function getWorktree() {
	// Try acquireVsCodeApi().getState() first
	try {
		var api = acquireVsCodeApi();
		var state = api.getState();
		if (state && state.worktree) return state.worktree;
	} catch (_) { /* not available yet */ }

	// Fallback: listen for an 'init' postMessage (extension sends
	// { type: 'init', worktree: '...' } on panel creation).
	// Return null for now; the caller retries.
	return null;
}

// ----- Storage interceptor -----

function setupStorageIsolation(worktree, sha) {
	var workspaceDataKey = 'vsoc-workspace-' + sha;

	// Keys that belong to the workspace (isolated per worktree)
	var workspaceKeys = [
		'opencode.global.dat:layout',
		'opencode.global.dat:model',
		'opencode.global.dat:prompt-history',
		'opencode.window.browser.dat:tabs',
		'opencode.window.browser.dat:tabs.info',
		'opencode.window.browser.dat:tabs.recent',
	];

	// Keys that are shared across all workspaces
	var globalKeys = [
		'settings.v3',
		'opencode-theme-id',
	];

	// Load existing workspace data
	var workspaceData = {};
	try {
		var raw = localStorage.getItem(workspaceDataKey);
		if (raw) workspaceData = JSON.parse(raw);
	} catch (_) {}

	var tempEnv = {};

	var origSetItem = localStorage.setItem.bind(localStorage);
	var origGetItem = localStorage.getItem.bind(localStorage);

	localStorage.setItem = function (key, val) {
		if (globalKeys.indexOf(key) !== -1) {
			origSetItem(key, val);
			return;
		}
		if (workspaceKeys.indexOf(key) !== -1) {
			workspaceData[key] = val;
			origSetItem(workspaceDataKey, JSON.stringify(workspaceData));
			return;
		}
		tempEnv[key] = val;
	};

	localStorage.getItem = function (key) {
		if (globalKeys.indexOf(key) !== -1) {
			return origGetItem(key);
		}
		if (workspaceKeys.indexOf(key) !== -1) {
			var v = workspaceData[key];
			return v !== undefined ? v : null;
		}
		var v = tempEnv[key];
		return v !== undefined ? v : null;
	};

	return workspaceDataKey;
}

// ----- Helpers for storage mutation -----

function modifyStorage(key, fn) {
	var data = {};
	try {
		var raw = localStorage.getItem(key);
		if (raw) data = JSON.parse(raw);
	} catch (_) {}
	fn(data);
	localStorage.setItem(key, JSON.stringify(data));
}

function ensureStorage(key, generator) {
	var val = localStorage.getItem(key);
	if (val == null || val === undefined) {
		localStorage.setItem(key, generator());
	}
}

// =========================================================================
// Section C — Project sidebar & new-layout injection
// =========================================================================

function injectProjectAndLayout(worktree) {
	// Enable new layout designs
	modifyStorage('settings.v3', function (data) {
		if (!data.general) data.general = {};
		data.general.newLayoutDesigns = true;
	});

	// Inject project info into server data
	modifyStorage('opencode.global.dat:server', function (data) {
		data.projects = {
			local: [
				{ worktree: worktree, expanded: true }
			]
		};
		data.list = [];
		data.lastProject = { local: worktree };
		data.recentlyClosed = { local: [] };
	});

	// Ensure tab storages exist
	ensureStorage('opencode.window.browser.dat:tabs', function () { return '[]'; });
	ensureStorage('opencode.window.browser.dat:tabs.info', function () { return '{}'; });
	ensureStorage('opencode.window.browser.dat:tabs.recent', function () { return '{}'; });
}

// =========================================================================
// Bootstrap — retry until worktree is available, then wire everything
// =========================================================================

async function bootstrap() {
	var worktree = getWorktree();
	if (!worktree) {
		// Wait for the init postMessage
		await new Promise(function (resolve) {
			function handler(event) {
				var msg = event.data;
				if (msg && msg.type === 'init' && msg.worktree) {
					worktree = msg.worktree;
					window.removeEventListener('message', handler);
					resolve();
				}
			}
			window.addEventListener('message', handler);
		});
	}

	var sha = await sha256(worktree);
	setupStorageIsolation(worktree, sha);
	injectProjectAndLayout(worktree);
}

// Wait for DOM readiness, then bootstrap
if (document.readyState !== 'loading') {
	bootstrap();
} else {
	document.addEventListener('DOMContentLoaded', bootstrap);
}

})();`;
