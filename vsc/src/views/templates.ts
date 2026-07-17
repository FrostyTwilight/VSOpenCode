/**
 * HTML page templates for the VS Code webview panel.
 *
 * Ported from the Visual Studio extension's Resources/LoadingPage.html
 * and Resources/ErrorPage.html, adapted to use VS Code CSS variables
 * and the VS Code webview message API.
 */

/**
 * Generate a loading page with a spinner and message text.
 *
 * @param message - Text to display below the spinner.
 * @returns Complete HTML document as a string.
 */
export function getLoadingPageHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        padding: 20px;
        user-select: none;
        -webkit-user-select: none;
    }
    .loading-container {
        text-align: center;
    }
    .spinner {
        width: 40px;
        height: 40px;
        margin: 0 auto 20px;
        border: 3px solid var(--vscode-editorWidget-border);
        border-top-color: var(--vscode-focusBorder);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    .loading-text {
        font-size: 14px;
        color: var(--vscode-descriptionForeground);
    }
</style>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">${escapeHtml(message)}</div>
    </div>
</body>
</html>`;
}

/**
 * Generate an error page with an optional retry button.
 *
 * @param message - Error message to display. Newlines are converted to
 *   `<br>` elements.
 * @param canRetry - When `true`, a "Retry" button is rendered that posts
 *   `{ type: 'retry' }` back to the extension host via the VS Code
 *   webview message API.
 * @returns Complete HTML document as a string.
 */
export function getErrorPageHtml(message: string, canRetry: boolean): string {
  const messageHtml = message
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>');

  const buttonHtml = canRetry
    ? `<button id="retry-btn">Retry</button>`
    : '';

  const scriptHtml = canRetry
    ? `<script>
        const vscode = acquireVsCodeApi();
        document.getElementById('retry-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'retry' });
        });
    </script>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        padding: 20px;
        user-select: none;
        -webkit-user-select: none;
    }
    .error-container {
        text-align: center;
        max-width: 420px;
    }
    .error-icon {
        font-size: 48px;
        margin-bottom: 16px;
    }
    .error-message {
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 24px;
        word-wrap: break-word;
    }
    button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 8px 24px;
        font-size: 14px;
        border-radius: 4px;
        cursor: pointer;
        transition: opacity 0.2s;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">&#9888;</div>
        <div class="error-message">${messageHtml}</div>
        ${buttonHtml}
    </div>
    ${scriptHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Escape user-provided text for safe HTML embedding.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
