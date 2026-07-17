import * as http from "http";
import type { Disposable } from "vscode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base port offset for the proxy. Computed port = BASE + (DJB2 hash % RANGE). */
const PROXY_PORT_BASE = 15000;
const PROXY_PORT_RANGE = 1000;

/** Maximum number of successive port retries when the computed port is in use. */
const MAX_PORT_RETRIES = 10;

/** CSP-related response headers to strip before forwarding to the webview. */
const CSP_HEADERS = new Set([
	"content-security-policy",
	"content-security-policy-report-only",
]);

/** Hop-by-hop headers that should NOT be forwarded to the target. */
const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"transfer-encoding",
	"proxy-connection",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"upgrade",
]);

/** Content-Type prefix that triggers HTML script injection. */
const HTML_CT_PREFIX = "text/html";

/** Content-Type prefix that triggers unbuffered SSE passthrough. */
const SSE_CT_PREFIX = "text/event-stream";

// ---------------------------------------------------------------------------
// ProxyServer
// ---------------------------------------------------------------------------

/**
 * Thin local HTTP proxy that provides a stable `localhost` origin for the
 * VS Code webview, injects theme / localStorage hooks, and proxies all other
 * requests through to the upstream OpenCode server.
 *
 * ## Usage
 *
 * ```ts
 * const proxy = new ProxyServer("http://127.0.0.1:4096");
 * const port = await proxy.start();
 * const panel = vscode.window.createWebviewPanel(/* ... *​/);
 * panel.webview.html = await fetch(`http://localhost:${port}/`).then(r => r.text());
 * // … later
 * proxy.dispose();
 * ```
 */
export class ProxyServer implements Disposable {
	// -----------------------------------------------------------------------
	// Fields
	// -----------------------------------------------------------------------

	private readonly targetUrl: string;
	private server: http.Server | null = null;
	private portValue = 0;

	// -----------------------------------------------------------------------
	// Constructor
	// -----------------------------------------------------------------------

	/**
	 * @param targetUrl The OpenCode server base URL (e.g. `http://127.0.0.1:4096`).
	 */
	constructor(targetUrl: string) {
		this.targetUrl = targetUrl.replace(/\/+$/, "");
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Create the HTTP server, bind to a stable port derived from the target
	 * URL, and begin accepting connections.
	 *
	 * @returns The port number the server is listening on.
	 */
	async start(): Promise<number> {
		if (this.server) {
			return this.portValue;
		}

		this.server = http.createServer((req, res) => {
			this._handleRequest(req, res);
		});

		const basePort = this._computePort();
		this.portValue = await this._listenWithRetry(basePort);
		return this.portValue;
	}

	/**
	 * Shut down the HTTP server.
	 */
	async stop(): Promise<void> {
		if (!this.server) {
			return;
		}
		return new Promise<void>((resolve, reject) => {
			this.server!.close((err) => {
				if (err) {
					reject(err);
				} else {
					this.server = null;
					this.portValue = 0;
					resolve();
				}
			});
		});
	}

	/**
	 * {@link Disposable} implementation — closes the server synchronously
	 * (fire-and-forget).
	 */
	dispose(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
			this.portValue = 0;
		}
	}

	// -----------------------------------------------------------------------
	// Public accessors
	// -----------------------------------------------------------------------

	/** Full proxy origin (e.g. `http://localhost:15042`). */
	getProxyUrl(): string {
		return `http://127.0.0.1:${this.portValue}`;
	}

	// -----------------------------------------------------------------------
	// Port computation (DJB2 hash → stable port)
	// -----------------------------------------------------------------------

	private _computePort(): number {
		const hash = this._djb2(this.targetUrl);
		return PROXY_PORT_BASE + (hash % PROXY_PORT_RANGE);
	}

	/**
	 * DJB2 string hash — small, fast, deterministic across processes.
	 * Returns an unsigned 32-bit integer.
	 */
	private _djb2(str: string): number {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
		}
		return hash >>> 0;
	}

	/**
	 * Attempt to listen on `startPort`.  If the port is already bound,
	 * increment and retry up to {@link MAX_PORT_RETRIES} times.
	 */
	private _listenWithRetry(startPort: number): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			let attempts = 0;

			const tryPort = (port: number) => {
				if (attempts > MAX_PORT_RETRIES) {
					reject(
						new Error(
							`ProxyServer: failed to bind after ${MAX_PORT_RETRIES} port attempts (started at ${startPort})`,
						),
					);
					return;
				}
				attempts++;

				const onError = (err: NodeJS.ErrnoException) => {
					if (err.code === "EADDRINUSE") {
						tryPort(port + 1);
					} else {
						reject(err);
					}
				};

				this.server!.once("error", onError);
				this.server!.listen(port, "127.0.0.1", () => {
					this.server!.removeListener("error", onError);
					resolve(port);
				});
			};

			tryPort(startPort);
		});
	}

	// -----------------------------------------------------------------------
	// Request routing
	// -----------------------------------------------------------------------

	private _handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		const url = req.url ?? "/";
		const method = req.method ?? "GET";

		if (method === "GET" && url === "/inject.js") {
			this._serveInjectScript(res);
		} else if (method === "GET" && url === "/") {
			this._serveLoadingPage(res);
		} else {
			this._proxyRequest(req, res);
		}
	}

	// -----------------------------------------------------------------------
	// Built-in routes
	// -----------------------------------------------------------------------

	/** Serve the placeholder inject script. */
	private _serveInjectScript(res: http.ServerResponse): void {
		const body =
			"// OpenCode VS Code extension - inject script placeholder\n";
		res.writeHead(200, {
			"Content-Type": "application/javascript",
			"Content-Length": Buffer.byteLength(body),
		});
		res.end(body);
	}

	/** Serve a minimal loading page with a CSS spinner. */
	private _serveLoadingPage(res: http.ServerResponse): void {
		const html =
			"<!DOCTYPE html>\n" +
			'<html lang="en">\n' +
			"<head>\n" +
			'<meta charset="UTF-8">\n' +
			'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
			"<title>OpenCode</title>\n" +
			"<style>\n" +
			"  *{margin:0;padding:0;box-sizing:border-box}\n" +
			"  body{display:flex;align-items:center;justify-content:center;min-height:100vh;" +
			"background:var(--vscode-editor-background,#1e1e1e);" +
			"color:var(--vscode-editor-foreground,#d4d4d4);" +
			"font-family:var(--vscode-font-family,-apple-system,sans-serif)}\n" +
			"  .spinner{width:40px;height:40px;border:3px solid var(--vscode-editorWidget-border,#3c3c3c);" +
			"border-top-color:var(--vscode-focusBorder,#007acc);" +
			"border-radius:50%;animation:spin .8s linear infinite}\n" +
			"  @keyframes spin{to{transform:rotate(360deg)}}\n" +
			"  .container{text-align:center}\n" +
			"  .container p{margin-top:16px;font-size:14px;opacity:.8}\n" +
			"</style>\n" +
			"</head>\n" +
			"<body>\n" +
			'<div class="container">\n' +
			'  <div class="spinner"></div>\n' +
			"  <p>Loading OpenCode…</p>\n" +
			"</div>\n" +
			"</body>\n" +
			"</html>\n";
		res.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Length": Buffer.byteLength(html),
		});
		res.end(html);
	}

	// -----------------------------------------------------------------------
	// Proxying
	// -----------------------------------------------------------------------

	/**
	 * Forward the incoming request to the upstream OpenCode server, strip
	 * CSP headers from the response, inject the script tag into HTML, and
	 * pass SSE streams through without buffering.
	 */
	private _proxyRequest(
		clientReq: http.IncomingMessage,
		clientRes: http.ServerResponse,
	): void {
		const target = new URL(this.targetUrl);

		// Build forwarded headers — strip hop-by-hop, fix Host.
		const fwdHeaders: Record<string, string> = {};
		for (const [key, value] of Object.entries(clientReq.headers)) {
			const lower = key.toLowerCase();
			if (HOP_BY_HOP.has(lower)) {
				continue;
			}
			if (value === undefined) {
				continue;
			}
			fwdHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
		}
		fwdHeaders.host = target.host;

		const proxyReq = http.request(
			{
				hostname: target.hostname,
				port: target.port || (target.protocol === "https:" ? 443 : 80),
				path: clientReq.url ?? "/",
				method: clientReq.method ?? "GET",
				headers: fwdHeaders,
			},
			(proxyRes) => {
				this._handleProxyResponse(clientRes, proxyRes);
			},
		);

		proxyReq.on("error", (err) => {
			if (!clientRes.headersSent) {
				clientRes.writeHead(502, { "Content-Type": "text/plain" });
				clientRes.end(`Proxy error: ${err.message}`);
			} else {
				clientRes.destroy();
			}
		});

		// Forward the request body for methods that carry one.
		const method = (clientReq.method ?? "GET").toUpperCase();
		if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
			proxyReq.end();
		} else {
			clientReq.pipe(proxyReq);
			// If the client disconnects mid-stream, abort the upstream request.
			clientReq.once("close", () => {
				if (!proxyReq.destroyed) {
					proxyReq.destroy();
				}
			});
		}
	}

	/**
	 * Process the upstream response: strip CSP, inject into HTML,
	 * passthrough SSE, or pipe unchanged.
	 */
	private _handleProxyResponse(
		clientRes: http.ServerResponse,
		proxyRes: http.IncomingMessage,
	): void {
		const contentType = this._firstHeader(proxyRes.headers, "content-type");

		// Build response headers, stripping CSP.
		const resHeaders: Record<string, string | number | string[]> = {};
		for (const [key, value] of Object.entries(proxyRes.headers)) {
			if (value === undefined) {
				continue;
			}
			if (CSP_HEADERS.has(key.toLowerCase())) {
				continue;
			}
			resHeaders[key] = value;
		}

		const statusCode = proxyRes.statusCode ?? 200;

		// -- SSE passthrough (no buffering) ----------------------------------
		if (contentType?.startsWith(SSE_CT_PREFIX)) {
			clientRes.writeHead(statusCode, resHeaders);
			proxyRes.pipe(clientRes);
			return;
		}

		// -- HTML injection --------------------------------------------------
		if (contentType?.startsWith(HTML_CT_PREFIX)) {
			const chunks: Buffer[] = [];
			proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
			proxyRes.on("end", () => {
				try {
					const body = Buffer.concat(chunks).toString("utf-8");
					const modified = this._injectScriptTag(body);
					// Replace content-length (body size changed) and drop
					// transfer-encoding so the updated content-length is used.
					resHeaders["content-length"] = Buffer.byteLength(modified);
					for (const k of Object.keys(resHeaders)) {
						if (k.toLowerCase() === "transfer-encoding") {
							delete resHeaders[k];
						}
					}
					clientRes.writeHead(statusCode, resHeaders);
					clientRes.end(modified);
				} catch {
					// If body decoding fails, forward the raw bytes.
					clientRes.writeHead(statusCode, resHeaders);
					clientRes.end(Buffer.concat(chunks));
				}
			});
			proxyRes.on("error", () => {
				if (!clientRes.headersSent) {
					clientRes.writeHead(502);
					clientRes.end();
				}
			});
			return;
		}

		// -- Default: pipe as-is ---------------------------------------------
		clientRes.writeHead(statusCode, resHeaders);
		proxyRes.pipe(clientRes);
	}

	// -----------------------------------------------------------------------
	// HTML script injection
	// -----------------------------------------------------------------------

	/**
	 * Insert `<script src="/inject.js"></script>` into an HTML string just
	 * before `</head>` (preferred) or `</body>` (fallback).
	 */
	private _injectScriptTag(html: string): string {
		const scriptTag = '<script src="/inject.js"></script>';

		const headClose = /<\/head>/i;
		if (headClose.test(html)) {
			return html.replace(headClose, `${scriptTag}\n</head>`);
		}

		const bodyClose = /<\/body>/i;
		if (bodyClose.test(html)) {
			return html.replace(bodyClose, `${scriptTag}\n</body>`);
		}

		return html + `\n${scriptTag}`;
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Return the first value of a header from an {@link IncomingHttpHeaders}
	 * object, respecting the fact that headers can be `string | string[]`.
	 */
	private _firstHeader(
		headers: http.IncomingHttpHeaders,
		name: string,
	): string | undefined {
		const value = headers[name.toLowerCase()];
		if (Array.isArray(value)) {
			return value[0];
		}
		return value ?? undefined;
	}
}
