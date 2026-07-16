using Microsoft.VisualStudio.PlatformUI;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Controls;
using VSOpenCode.Commands;
using VSOpenCode.Models;
using VSOpenCode.Resources;
using VSOpenCode.Services;

namespace VSOpenCode
{
    public partial class OpenCodeToolWindowControl : UserControl, IDisposable
    {
        [ClassInterface(ClassInterfaceType.AutoDual)]
        [ComVisible(true)]
        public class WebView2HostBridge(
            Func<string> getWorktree,
            Func<string> getThemeColors
            )
        {
            public string GetWorktree()
            {
                return getWorktree();
            }
            public string GetWorktreeSHA()
            {
                
                return BitConverter.ToString(SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(getWorktree()))).Replace("-", "");
            }
            public string GetThemeColors()
            {
                return getThemeColors();
            }
        }

        private IServiceProvider _serviceProvider;

        private CoreWebView2Environment _environment;
        private IProjectRootResolver _projectRootResolver;
        private ServerController _serverController;


        private string _currentProjectRoot;
        private bool _isDisposed;
        private bool _isStarting;
        private bool _retryDisabled;
        private bool _isShowingError;
        private System.Threading.Timer _projRootTimer;
        private bool _themeChangeSubscribed;

        private static readonly string ErrorPageTemplate;
        private static readonly string LoadingPageTemplate;
        private static readonly string InjectScript;

        static OpenCodeToolWindowControl()
        {
            var assembly = Assembly.GetExecutingAssembly();
            ErrorPageTemplate = LoadResourceString(assembly, "VSOpenCode.Resources.ErrorPage.html");
            LoadingPageTemplate = LoadResourceString(assembly, "VSOpenCode.Resources.LoadingPage.html");
            InjectScript = LoadResourceString(assembly, "VSOpenCode.Resources.Inject.js");
        }

        private static string LoadResourceString(Assembly assembly, string name)
        {
            using (var stream = assembly.GetManifestResourceStream(name))
            using (var reader = new StreamReader(stream))
            {
                return reader.ReadToEnd();
            }
        }

        public OpenCodeToolWindowControl()
        {
            InitializeComponent();
            _ = InitWebViewCoreAsync()
                .ContinueWith(_ => WaitServerAsync(), TaskScheduler.Current);
        }

        public void SetServiceProvider(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
        }

        /// <summary>
        /// Set the shared server controller. Must be called before StartAsync.
        /// </summary>
        public void SetServerController(ServerController controller)
        {
            _serverController = controller;
            if (_serverController != null)
            {
                _serverController.ConnectionLost += OnServerConnectionLost;
                _serverController.ConnectionRestored += OnServerConnectionRestored;
            }
        }

        private void SetCurrentProjectRoot(string root)
        {
            _currentProjectRoot = root;
        }

        private Dictionary<string, string> GetThemeColors()
        {
            var colors = new Dictionary<string, string>();
            try
            {
                // Backgrounds
                colors["bg"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey));
                colors["bgPanel"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowTabGradientBeginColorKey));
                colors["bgContent"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowContentGridColorKey));
                colors["bgInput"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxBackgroundColorKey));
                colors["bgSurface"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.CommandBarGradientBeginColorKey));
                // Text
                colors["textPrimary"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowTextColorKey));
                colors["textSecondary"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.CommandBarTextInactiveColorKey));
                colors["textInput"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxTextColorKey));
                // Accent & Selection
                colors["textAccent"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.AccentBorderColorKey));
                colors["bgSelected"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.CommandBarSelectedColorKey));
                colors["bgHover"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.CommandBarHoverOverSelectedColorKey));
                // Borders & Scrollbar
                colors["border"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBorderColorKey));
                colors["scrollbar"] = ToHtml(VSColorTheme.GetThemedColor(EnvironmentColors.ScrollBarThumbBackgroundColorKey));
            }
            catch { }
            return colors;
        }

        private string GetThemeColorsJson()
        {
            return JsonConvert.SerializeObject(GetThemeColors());
        }

        private string GetThemeStyleBlock()
        {
            var c = GetThemeColors();
            string bg   = c.TryGetValue("bg", out var v0) ? v0 : "#252526";
            string text = c.TryGetValue("textPrimary", out var v1) ? v1 : "#f1f1f1";
            string textMuted = c.TryGetValue("textSecondary", out var v2) ? v2 : "#999999";
            string accent = c.TryGetValue("textAccent", out var v3) ? v3 : "#007acc";
            string border = c.TryGetValue("border", out var v4) ? v4 : "#434346";
            var accentHover = LighterHex(accent, 0.20);
            var spinnerTrack = LighterHex(bg, 0.12);

            return $@"<style id=""vscode-page-theme"">
    :root {{
        --vs-bg: {bg};
        --vs-text: {text};
        --vs-text-muted: {textMuted};
        --vs-accent: {accent};
        --vs-accent-hover: {accentHover};
        --vs-border: {border};
        --vs-spinner-track: {spinnerTrack};
    }}
</style>";
        }

        private static string LighterHex(string hex, double amount)
        {
            try
            {
                int r = Convert.ToInt32(hex.Substring(1, 2), 16);
                int g = Convert.ToInt32(hex.Substring(3, 2), 16);
                int b = Convert.ToInt32(hex.Substring(5, 2), 16);
                r = Math.Min(255, (int)(r + (255 - r) * amount));
                g = Math.Min(255, (int)(g + (255 - g) * amount));
                b = Math.Min(255, (int)(b + (255 - b) * amount));
                return $"#{r:X2}{g:X2}{b:X2}";
            }
            catch { return hex; }
        }

        private static string ToHtml(Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";

        private void SubscribeThemeChanged()
        {
            if (_themeChangeSubscribed) return;
            _themeChangeSubscribed = true;
            VSColorTheme.ThemeChanged += OnVSThemeChanged;
        }

        private void OnVSThemeChanged(ThemeChangedEventArgs e)
        {
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                try
                {
                    if (webView?.CoreWebView2 != null)
                    {
                        await webView.CoreWebView2.ExecuteScriptAsync(
                            "window.__vscode_onThemeChange && window.__vscode_onThemeChange()");
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"Theme change notify failed: {ex}");
                }
            });
        }

        private async Task InitWebViewCoreAsync()
        {
            try
            {
                var userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "VSOpenCode",
                    "WebView2");

                Directory.CreateDirectory(userDataFolder);

                _environment = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: null,
                    userDataFolder: userDataFolder);

                await webView.EnsureCoreWebView2Async(_environment);

                webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                webView.CoreWebView2.ContentLoading += CoreWebView2_ContentLoading;
               
                await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(InjectScript);

                webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
                webView.CoreWebView2.WebResourceRequested += CoreWebView2_WebResourceRequested;

                SubscribeThemeChanged();

                await ShowLoadingPageAsync(StringsHelper.UILoading);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"WebView2 init failed: {ex}");
                await ShowErrorPageAsync(
                    $"{StringsHelper.ErrorWebViewInitFailed}: {ex}", false);
            }
        }

        private void CoreWebView2_ContentLoading(object sender, CoreWebView2ContentLoadingEventArgs e)
        {
            webView.CoreWebView2.AddHostObjectToScript("vsoc", new WebView2HostBridge(
                   () => _currentProjectRoot,
                   () => GetThemeColorsJson()
                   ));
        }

        private async void CoreWebView2_WebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var serverInfo = _serverController.ServerService.ServerInfo;
            var deferral = e.GetDeferral();

            try
            {
                var uri = new Uri(e.Request.Uri);

                if (!uri.Host.EndsWith(".vsoc-app"))
                {
                    return;
                }

                var uriBuilder = new UriBuilder(e.Request.Uri)
                {
                    Host = serverInfo.Host,
                    Port = serverInfo.Port,
                };

                var realUri = uriBuilder.Uri;

                if(e.Request.Uri.ToString().EndsWith("/event"))
                {
                    //SSE
                    e.Request.Uri = realUri.ToString();
                    return;
                }

                Debug.WriteLine("[VSOC] Web Request: " + realUri);

                var req = new HttpRequestMessage()
                {
                    RequestUri = realUri,
                    Method = new(e.Request.Method),
                };

                if (e.Request.Content != null)
                {
                    req.Content = new StreamContent(e.Request.Content);
                }

                req.Headers.Clear();

                foreach (var v in e.Request.Headers)
                {
                    req.Headers.TryAddWithoutValidation(v.Key, v.Value);
                }

                var client = _serverController.ServerService.GetClient();
                var response = await client.SendAsync(req);

                bool isSse = string.Equals(
                    response.Content.Headers.ContentType?.MediaType,
                    "text/event-stream",
                    StringComparison.OrdinalIgnoreCase);

                if(isSse)
                {
                    //SSE
                    e.Request.Uri = realUri.ToString();
                    return;
                }

                var cleanHeaders = new List<string>();
                foreach (var header in response.Headers)
                {
                    if (header.Key.Equals("Content-Security-Policy", StringComparison.OrdinalIgnoreCase) ||
                        header.Key.Equals("Content-Security-Policy-Report-Only", StringComparison.OrdinalIgnoreCase))
                        continue;
                    cleanHeaders.Add($"{header.Key}: {string.Join(",", header.Value)}");
                }
                foreach (var header in response.Content.Headers)
                {
                    if (header.Key.Equals("Content-Security-Policy", StringComparison.OrdinalIgnoreCase))
                        continue;
                    cleanHeaders.Add($"{header.Key}: {string.Join(",", header.Value)}");
                }

                Stream content = await response.Content.ReadAsStreamAsync();

                e.Response = webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    content, (int)response.StatusCode, response.ReasonPhrase,
                    string.Join("\n", cleanHeaders));
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex.ToString());
            }
            finally
            {
                deferral.Complete();
            }
        }

        private async Task WaitServerAsync()
        {
            await Task.Delay(500);
            if(_serverController == null)
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                ShowOpenCodeWindowCommand.Instance.RefreshWindow();
            }
        }

        public async Task StartAsync()
        {
            if (_isStarting) return;
            _isStarting = true;

            try
            {
                // Check server status before starting flow
                if (webView.CoreWebView2 != null && _serverController != null)
                {
                    var isRunning = _serverController.State == ConnectionState.Connected;
                    System.Diagnostics.Debug.WriteLine(
                        $"Tool window init: server running={isRunning}, proj={_currentProjectRoot}");
                }

                await StartFlowAsync();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Start flow failed: {ex}");
                await ShowErrorPageAsync($"Failed: {ex}", true);
            }
            finally
            {
                _isStarting = false;
            }
        }

        public void OnWindowClosing()
        {
            _projRootTimer?.Dispose();
            _projRootTimer = null;
        }

        private void OnServerConnectionLost()
        {
            var state = _serverController?.State ?? ConnectionState.Disconnected;
            System.Diagnostics.Debug.WriteLine($"Server connection lost! State: {state}");

            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var msg = state switch
                {
                    ConnectionState.Error => "OpenCode server encountered an error.\n\nClick Retry to restart.",
                    _ => StringsHelper.ErrorConnectionLost
                };
                await ShowErrorPageAsync(msg, true);
            });
        }

        private void OnServerConnectionRestored()
        {
            System.Diagnostics.Debug.WriteLine("Server connection restored!");
            _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var url = _serverController?.GetSessionUrl();
                if (url != null && webView.CoreWebView2 != null)
                    webView.CoreWebView2.Navigate(url);
                else
                    await StartFlowAsync();
            });
        }

        private async Task StartFlowAsync()
        {
            await ShowLoadingPageAsync(StringsHelper.UIConnecting);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            // Resolve project root
            if (_projectRootResolver == null)
                _projectRootResolver = new ProjectRootResolver(_serviceProvider);
            var newProjectRoot = _projectRootResolver.ResolveProjectRoot();
            System.Diagnostics.Debug.WriteLine($"Project root: {newProjectRoot} (current: {_currentProjectRoot})");

            if (_serverController == null) return;

            // If workspace unchanged and server already connected, just navigate
            if (string.Equals(newProjectRoot, _currentProjectRoot, StringComparison.OrdinalIgnoreCase)
                && _serverController.State == ConnectionState.Connected
                && !string.IsNullOrEmpty(_serverController.CurrentSessionId))
            {
                var existingUrl = _serverController.GetSessionUrl();
                if (existingUrl != null)
                {
                    NavigateToSession(existingUrl, newProjectRoot);
                    return;
                }
            }

            SetCurrentProjectRoot(newProjectRoot);

            // Start server and get session
            var success = await _serverController.StartAsync(_currentProjectRoot);
            if (!success)
            {
                await ShowErrorPageAsync(StringsHelper.ErrorServerStartFailed, true);
                return;
            }

            var sessionUrl = _serverController.GetSessionUrl();
            if (sessionUrl != null)
            {
                NavigateToSession(sessionUrl, _currentProjectRoot);
            }

            _projRootTimer?.Dispose();
            _projRootTimer = new System.Threading.Timer(_ =>
            {
                _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                {
                    try
                    {
                        // Direct HTTP health check every 5s
                        if (_serverController?.ServerService != null)
                        {
                            var healthy = await _serverController.ServerService.CheckHealthAsync();
                            if (!healthy && _serverController.State != ConnectionState.Connecting
                                && !_isStarting && !_isShowingError)
                            {
                                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                                await ShowErrorPageAsync(StringsHelper.ErrorConnectionLost, true);
                                return;
                            }
                        }

                        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                        if (_projectRootResolver == null)
                            _projectRootResolver = new ProjectRootResolver(_serviceProvider);
                        var resolved = _projectRootResolver.ResolveProjectRoot();
                        if (!string.Equals(resolved, _currentProjectRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            System.Diagnostics.Debug.WriteLine($"proj_root changed: {_currentProjectRoot} -> {resolved}");
                            SetCurrentProjectRoot(resolved);
                            _serverController?.UpdateProjectRoot(resolved);
                        }
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"timer: {ex}");
                    }
                });
            }, null, 5000, 5000);
        }

        private void NavigateToSession(string sessionUrl, string projectRoot)
        {
            _isShowingError = false;
            if (webView.CoreWebView2 == null) return;

            System.Diagnostics.Debug.WriteLine($"Navigating to: {sessionUrl}");

            webView.CoreWebView2.Navigate(sessionUrl);
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            var message = e.TryGetWebMessageAsString();
            if (message == "retry" && !_retryDisabled)
            {
                _retryDisabled = true;
                _isShowingError = false;
#pragma warning disable VSSDK007
                _ = ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                    try
                    {
                        await StartFlowAsync();
                    }
                    finally
                    {
                        _retryDisabled = false;
                    }
                });
#pragma warning restore VSSDK007
            }
        }

        private async Task ShowLoadingPageAsync(string message)
        {
            var html = LoadingPageTemplate
                .Replace("{theme-style}", GetThemeStyleBlock())
                .Replace("{message}", message);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            if (webView.CoreWebView2 != null)
            {
                webView.CoreWebView2.NavigateToString(html);
            }
        }

        private async Task ShowErrorPageAsync(string message, bool showRetry)
        {
            var escapedMessage = System.Net.WebUtility.HtmlEncode(message)
                .Replace("\n", "<br>")
                .Replace("\\n", "<br>");
            var retryButton = showRetry
                ? $@"<button id=""retryBtn"" onclick=""handleRetry()"">{StringsHelper.UIRetry}</button>"
                : "";
            var retryScript = showRetry
                ? @"var disabled=false;function handleRetry(){if(disabled)return;disabled=true;var b=document.getElementById('retryBtn');b.disabled=true;b.style.opacity='0.5';b.style.cursor='not-allowed';try{window.chrome.webview.postMessage('retry')}catch(e){}}"
                : "";

            var html = ErrorPageTemplate
                .Replace("{theme-style}", GetThemeStyleBlock())
                .Replace("{message}", escapedMessage)
                .Replace("{retryButton}", retryButton)
                .Replace("{retryScript}", retryScript);

            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            if (webView.CoreWebView2 != null)
            {
                webView.CoreWebView2.NavigateToString(html);
            }
        }

        public void Dispose()
        {
            if (_isDisposed) return;
            _isDisposed = true;
            _projRootTimer?.Dispose();
            if (_themeChangeSubscribed)
            {
                _themeChangeSubscribed = false;
                VSColorTheme.ThemeChanged -= OnVSThemeChanged;
            }
            webView?.Dispose();
        }
    }
}
