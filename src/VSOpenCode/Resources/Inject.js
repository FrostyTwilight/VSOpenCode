
// ===== Visual Studio Theme CSS Injection =====
(function () {
    'use strict';

    // ---- Color utility helpers ----
    function hexToRgb(hex) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return { r: r, g: g, b: b };
    }

    function rgbStr(c) {
        return c.r + ',' + c.g + ',' + c.b;
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(function (v) {
            var n = Math.max(0, Math.min(255, Math.round(v)));
            return n.toString(16).padStart(2, '0');
        }).join('');
    }

    function lighter(hex, amount) {
        var c = hexToRgb(hex);
        return rgbToHex(
            c.r + (255 - c.r) * amount,
            c.g + (255 - c.g) * amount,
            c.b + (255 - c.b) * amount
        );
    }

    function alphaColor(hex, a) {
        return 'rgba(' + rgbStr(hexToRgb(hex)) + ',' + a + ')';
    }

    // ---- Read colors from VS via WebView2 bridge ----
    function getVSThemeColors() {
        try {
            return JSON.parse(chrome.webview.hostObjects.sync.vsoc.GetThemeColors());
        } catch (e) {
            return null;
        }
    }

    // ---- Build the full CSS from VS theme colors ----
    function buildThemeCSS(rawColors) {
        if (!rawColors || Object.keys(rawColors).length === 0) return null;

        // ---- VS theme colors used directly (no derivation) ----
        var bg         = rawColors.bg || '#252526';
        var bgPanel    = rawColors.bgPanel || bg;
        var bgContent  = rawColors.bgContent || rawColors.bgPanel || bg;
        var bgInput    = rawColors.bgInput || '#333337';
        var bgSurface  = rawColors.bgSurface || rawColors.bgInput || bg;
        var bgHover    = rawColors.bgHover || alphaColor('#ffffff', 0.06);
        var bgSelected = rawColors.bgSelected || '#094771';
        var text       = rawColors.textPrimary || '#f1f1f1';
        var textMuted  = rawColors.textSecondary || '#999999';
        var accent     = rawColors.textAccent || '#007acc';
        var border     = rawColors.border || '#434346';
        var scrollbar  = rawColors.scrollbar || '#686868';

        // ---- Detect dark/light for the few unavoidable derivations ----
        var textRGB = hexToRgb(text);
        var textLum = (0.299 * textRGB.r + 0.587 * textRGB.g + 0.114 * textRGB.b) / 255;
        var isDark = textLum > 0.5;

        // ---- Minimal derivations (VS doesn't expose these) ----
        var accentHover   = lighter(accent, 0.10);
        var scrollbarHover = lighter(scrollbar, 0.15);
        var textFaint     = alphaColor(textMuted, 0.55);
        var borderMuted   = alphaColor(border, 0.5);
        var borderStrong  = alphaColor(border, 1.6);
        var inverseBg     = isDark ? '#ffffff' : '#000000';

        // Status colors (VS-like, not directly available from EnvironmentColors)
        var successFg = '#4ec9b0';
        var successBg = alphaColor(successFg, 0.15);
        var errorFg   = '#f14c4c';
        var errorBg   = alphaColor(errorFg, 0.15);
        var warningFg = '#cca700';
        var warningBg = alphaColor(warningFg, 0.15);

        // Build CSS string
        var css = [];

        // -- Legacy tokens (specificity: html[data-color-scheme="dark"] = 0,1,1 > :root = 0,1,0) --
        css.push('html[data-color-scheme="dark"] {');
        css.push('  --background-base:' + bg + ';');
        css.push('  --background-weak:' + bgPanel + ';');
        css.push('  --background-strong:' + bg + ';');
        css.push('  --background-stronger:' + bgInput + ';');
        css.push('  --surface-base:' + alphaColor(text, 0.04) + ';');
        css.push('  --surface-raised-strong:' + bgPanel + ';');
        css.push('  --surface-raised-stronger:' + bgInput + ';');
        css.push('  --text-strong:' + text + ';');
        css.push('  --text-base:' + textMuted + ';');
        css.push('  --text-weak:' + textMuted + ';');
        css.push('  --text-weaker:' + textFaint + ';');
        css.push('  --text-interactive-base:' + accent + ';');
        css.push('  --text-interactive-hover:' + accentHover + ';');
        css.push('  --input-base:' + bgInput + ';');
        css.push('  --input-focus:' + bg + ';');
        css.push('  --button-primary-base:' + accent + ';');
        css.push('  --button-primary-text:#ffffff;');
        css.push('  --button-secondary-base:' + bgInput + ';');
        css.push('  --button-secondary-text:' + text + ';');
        css.push('  --border-base:' + alphaColor(text, 0.12) + ';');
        css.push('  --border-strong:' + alphaColor(text, 0.20) + ';');
        css.push('  --border-selected:' + accent + ';');
        css.push('  --border-weak-base:' + bgInput + ';');
        css.push('  --icon-base:' + textMuted + ';');
        css.push('  --icon-hover:' + text + ';');
        css.push('  --icon-active:' + text + ';');
        css.push('  --icon-invert-base:' + bg + ';');

        css.push('  --markdown-heading:' + accent + ';');
        css.push('  --markdown-text:' + text + ';');
        css.push('  --markdown-link:' + accentHover + ';');
        css.push('  --markdown-code:' + textMuted + ';');
        css.push('  --markdown-block-quote:' + text + ';');

        css.push('  --text-diff-add-base:' + successFg + ';');
        css.push('  --text-diff-delete-base:' + errorFg + ';');
        css.push('  --surface-diff-add-base:' + successBg + ';');
        css.push('  --surface-diff-delete-base:' + errorBg + ';');
        css.push('}');

        // -- V2 tokens (specificity > [data-color-scheme]) --
        css.push('html[data-color-scheme="dark"] {');
        css.push('  --v2-background-bg-base:' + bg + ';');
        css.push('  --v2-background-bg-deep:' + bgContent + ';');
        css.push('  --v2-background-bg-layer-01:' + bgPanel + ';');
        css.push('  --v2-background-bg-layer-02:' + bgInput + ';');
        css.push('  --v2-background-bg-layer-03:' + bgHover + ';');
        css.push('  --v2-background-bg-inverse:' + inverseBg + ';');
        css.push('  --v2-background-bg-contrast:' + bgInput + ';');
        css.push('  --v2-background-bg-accent:' + accent + ';');

        css.push('  --v2-text-text-base:' + text + ';');
        css.push('  --v2-text-text-muted:' + textMuted + ';');
        css.push('  --v2-text-text-faint:' + textFaint + ';');
        css.push('  --v2-text-text-accent:' + accent + ';');
        css.push('  --v2-text-text-accent-hover:' + accentHover + ';');
        css.push('  --v2-text-text-inverse:' + bg + ';');

        css.push('  --v2-icon-icon-base:' + textMuted + ';');
        css.push('  --v2-icon-icon-accent:' + accent + ';');

        css.push('  --v2-border-border-muted:' + borderMuted + ';');
        css.push('  --v2-border-border-base:' + alphaColor(text, 0.12) + ';');
        css.push('  --v2-border-border-strong:' + borderStrong + ';');
        css.push('  --v2-border-border-focus:' + accent + ';');

        css.push('  --v2-state-bg-success:' + successBg + ';');
        css.push('  --v2-state-fg-success:' + successFg + ';');
        css.push('  --v2-state-bg-danger:' + errorBg + ';');
        css.push('  --v2-state-fg-danger:' + errorFg + ';');
        css.push('  --v2-state-bg-warning:' + warningBg + ';');
        css.push('  --v2-state-fg-warning:' + warningFg + ';');
        css.push('  --v2-state-bg-info:' + alphaColor(accent, 0.15) + ';');
        css.push('  --v2-state-fg-info:' + accent + ';');
        css.push('}');

        // -- Base element overrides --
        css.push('html[data-color-scheme="dark"] body {');
        css.push('  background-color:' + bg + ';');
        css.push('  color:' + text + ';');
        css.push('}');

        // -- Scrollbar --
        css.push('html[data-color-scheme="dark"] ::-webkit-scrollbar { width:10px; height:10px; }');
        css.push('html[data-color-scheme="dark"] ::-webkit-scrollbar-track { background:transparent; }');
        css.push('html[data-color-scheme="dark"] ::-webkit-scrollbar-thumb {');
        css.push('  background:' + scrollbar + '; border-radius:5px;');
        css.push('}');
        css.push('html[data-color-scheme="dark"] ::-webkit-scrollbar-thumb:hover {');
        css.push('  background:' + scrollbarHover + ';');
        css.push('}');
        css.push('html[data-color-scheme="dark"] ::-webkit-scrollbar-corner { background:transparent; }');

        // -- Inputs --
        css.push('html[data-color-scheme="dark"] input,');
        css.push('html[data-color-scheme="dark"] textarea {');
        css.push('  background-color:' + bgInput + ';');
        css.push('  color:' + text + ';');
        css.push('  border-color:' + alphaColor(text, 0.12) + ';');
        css.push('}');
        css.push('html[data-color-scheme="dark"] input::placeholder,');
        css.push('html[data-color-scheme="dark"] textarea::placeholder {');
        css.push('  color:' + textFaint + ';');
        css.push('}');

        // -- Code blocks --
        css.push('html[data-color-scheme="dark"] pre,');
        css.push('html[data-color-scheme="dark"] code {');
        css.push('  background-color:' + bgSurface + '; color:' + text + ';');
        css.push('}');

        var darkCSS = css.join('\n');
        var lightCSS = darkCSS.replace(/\[data-color-scheme="dark"\]/g, '[data-color-scheme="light"]');
        var normalCSS = darkCSS.replace(/\[data-color-scheme="dark"\]/g, '');
        return darkCSS + '\n' + lightCSS + '\n' + normalCSS;
    }

    // ---- Try to inject theme CSS ----
    function tryInjectThemeCSS() {
        if (document.getElementById('vscode-theme-inject')) return;

        var colors = getVSThemeColors();
        if (!colors || Object.keys(colors).length === 0) {
            // Bridge not ready yet, retry
            setTimeout(tryInjectThemeCSS, 100);
            return;
        }

        var css = buildThemeCSS(colors);
        if (!css) return;

        var style = document.createElement('style');
        style.id = 'vscode-theme-inject';
        style.textContent = css;

        if (document.head) {
            document.head.appendChild(style);
        }
    }

    // Expose global handler for VS theme change notifications from C# bridge
    window.__vscode_onThemeChange = function () {
        var old = document.getElementById('vscode-theme-inject');
        if (old) old.remove();
        tryInjectThemeCSS();
    };

    // Start injection when DOM is ready
    if (document.head && document.readyState !== 'loading') {
        tryInjectThemeCSS();
    } else {
        document.addEventListener('DOMContentLoaded', tryInjectThemeCSS);
    }
})();

// ===== Workspace localStorage Isolation & Project Injection =====

(function () {
    const worktree = chrome.webview.hostObjects.sync.vsoc.GetWorktree();
    const worktreeSHA = chrome.webview.hostObjects.sync.vsoc.GetWorktreeSHA();

    const workspaceDataKey = "vsoc-workspace-" + worktreeSHA;

    console.log("Loading workspace data from " + workspaceDataKey);

    const workspaceData = JSON.parse(localStorage.getItem(workspaceDataKey)) || {};

    const workspaceKeys = [
        "opencode.global.dat:layout",
        "opencode.global.dat:model",
        "opencode.global.dat:prompt-history",

        "opencode.window.browser.dat:tabs",
        "opencode.window.browser.dat:tabs.info",
        "opencode.window.browser.dat:tabs.recent"
    ];

    const globalKeys = [
        "settings.v3",
        "opencode-theme-id"
    ];

    const tempEnv = {};

    function modify_storage(key, func) {
        const data = JSON.parse(localStorage.getItem(key) || "{}") || {};
        func(data);
        localStorage.setItem(key, JSON.stringify(data));
    }

    function ensure_storage(key, generator) {
        const val = localStorage.getItem(key);
        if (val == null || val == undefined) {
            localStorage.setItem(key, generator());
        }
    }

    const orig_setItem = localStorage.setItem.bind(localStorage);
    const orig_getItem = localStorage.getItem.bind(localStorage);

    localStorage.setItem = function (key, val) {
        if (globalKeys.includes(key)) {
            orig_setItem(key, val);
            return;
        }
        if (workspaceKeys.includes(key)) {
            workspaceData[key] = val;
            orig_setItem(workspaceDataKey, JSON.stringify(workspaceData));
            return;
        }
        tempEnv[key] = val;
    };

    localStorage.getItem = function (key) {
        if (globalKeys.includes(key)) {
            return orig_getItem(key) || null;
        }
        if (workspaceKeys.includes(key)) {
            return workspaceData[key] || null;
        }
        return tempEnv[key] || null;
    }

    // Apply New Layout

    modify_storage('settings.v3', function (data) {
        if (!data.general) {
            data.general = {};
        }

        data.general.newLayoutDesigns = true;

    });
  
    // Inject Project

    modify_storage('opencode.global.dat:server', function (data) {
        data.projects = {
            local: [
                { worktree: worktree, expanded: true }
            ]
        };

        data.list = [];

        data.lastProject = {
            local: worktree
        };

        data.recentlyClosed = {
            local: []
        };
    })

    // Tabs

    ensure_storage('opencode.window.browser.dat:tabs', () => []);
    ensure_storage('opencode.window.browser.dat:tabs.info', () => { });
    ensure_storage('opencode.window.browser.dat:tabs.recent', () => { });
})();
