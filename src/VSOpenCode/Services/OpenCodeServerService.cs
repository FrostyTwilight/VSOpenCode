using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using VSOpenCode.Models;

namespace VSOpenCode.Services
{
    /// <summary>
    /// Manages OpenCode server lifecycle: process management and HTTP client provisioning.
    /// </summary>
    public class OpenCodeServerService : IOpenCodeServerService
    {
        private const string DefaultHost = "127.0.0.1";
        private const int DefaultPort = 4096;
        private const int ConnectTimeoutMs = 30000;
        private const int HealthCheckIntervalMs = 500;

        private System.Diagnostics.Process _process;
        private HttpClient _httpClient;
        private ServerInfo _serverInfo;
        private ConnectionState _state = ConnectionState.Disconnected;

        public ServerInfo ServerInfo => _serverInfo;
        public ConnectionState State => _state;
        public event Action<ConnectionState> StateChanged;

        public HttpClient GetClient()
        {
            return _httpClient;
        }

        public async Task<bool> StartAsync(string projectRoot)
        {
            Stop();

            SetState(ConnectionState.Connecting);

            try
            {
                // First, try to connect to an already-running server
                var defaultInfo = new ServerInfo(DefaultHost, DefaultPort);
                if (await TryConnectAsync(defaultInfo))
                {
                    _serverInfo = defaultInfo;
                    await InitializeHttpClientAsync();
                    SetState(ConnectionState.Connected);
                    return true;
                }

                var opencodePath = ResolveOpenCodePath();
                if (opencodePath == null)
                {
                    SetState(ConnectionState.Error);
                    return false;
                }

                var serverPassword = ServerPasswordManager.GeneratePassword();

                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = opencodePath,
                    Arguments = "serve",
                    WorkingDirectory = projectRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                psi.EnvironmentVariables["OPENCODE_SERVER_PASSWORD"] = serverPassword;

                _process = System.Diagnostics.Process.Start(psi);
                if (_process == null)
                {
                    SetState(ConnectionState.Error);
                    return false;
                }

                // Read output in background to find the listening URL
                var resolvedInfo = await ResolveServerUrlAsync(_process, DefaultHost, ConnectTimeoutMs);
                if (resolvedInfo != null)
                {
                    _serverInfo = resolvedInfo;
                }

                // Wait for the server to become healthy
                var healthy = await WaitForHealthAsync(ConnectTimeoutMs);
                if (healthy)
                {
                    await InitializeHttpClientAsync();
                    SetState(ConnectionState.Connected);
                    return true;
                }

                SetState(ConnectionState.Error);
                return false;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to start server: {ex.Message}");
                SetState(ConnectionState.Error);
                return false;
            }
        }

        private static async Task<ServerInfo> ResolveServerUrlAsync(
            System.Diagnostics.Process process, string defaultHost, int timeoutMs)
        {
            var tcs = new TaskCompletionSource<ServerInfo>();
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);

            // Read stdout and stderr in background
            async Task ReadStreamAsync(System.IO.StreamReader reader, string label)
            {
                try
                {
                    while (DateTime.UtcNow < deadline)
                    {
                        var lineTask = reader.ReadLineAsync();
                        var delayTask = Task.Delay(1000);

                        var completed = await Task.WhenAny(lineTask, delayTask);
                        if (completed == delayTask)
                            continue;

                        var line = await lineTask;
                        if (line == null) break;

                        System.Diagnostics.Debug.WriteLine($"OpenCode {label}: {line}");

                        if (TryParseListenLine(line, out string host, out int port))
                        {
                            tcs.TrySetResult(new ServerInfo(host, port));
                            return;
                        }
                    }
                }
                catch { }
            }

            var stdoutTask = ReadStreamAsync(process.StandardOutput, "stdout");
            var stderrTask = ReadStreamAsync(process.StandardError, "stderr");
            var timeoutTask = Task.Delay(timeoutMs);

            await Task.WhenAny(tcs.Task, timeoutTask);

            if (tcs.Task.IsCompleted)
                return await tcs.Task;

            return null;
        }

        private static bool TryParseListenLine(string line, out string host, out int port)
        {
            host = DefaultHost;
            port = DefaultPort;

            if (string.IsNullOrEmpty(line))
                return false;

            const string prefix = "opencode server listening on http://";
            var idx = line.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
            if (idx < 0)
                return false;

            var url = line.Substring(idx + prefix.Length).Trim();
            var colonIdx = url.LastIndexOf(':');
            if (colonIdx < 0)
                return false;

            host = url.Substring(0, colonIdx);
            return int.TryParse(url.Substring(colonIdx + 1), out port);
        }

        public async Task<bool> CheckHealthAsync()
        {
            if (_httpClient == null)
                return false;

            try
            {
                var response = await _httpClient.GetAsync("/global/health");
                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
                    var health = JsonConvert.DeserializeObject<HealthInfo>(json);
                    return health?.Healthy == true;
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        public void Stop()
        {
            _httpClient?.Dispose();
            _httpClient = null;
            _serverInfo = null;

            if (_process != null && !_process.HasExited)
            {
                try
                {
                    _process.Kill();
                    _process.WaitForExit(5000);
                }
                catch { }
                _process.Dispose();
            }
            _process = null;

            SetState(ConnectionState.Disconnected);
        }

        private async Task<bool> TryConnectAsync(ServerInfo info)
        {
            try
            {
                using (var client = CreateHttpClient(info))
                {
                    client.Timeout = TimeSpan.FromSeconds(3);
                    var response = await client.GetAsync("/global/health");
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        var health = JsonConvert.DeserializeObject<HealthInfo>(json);
                        return health?.Healthy == true;
                    }
                }
            }
            catch { }
            return false;
        }

        private async Task<bool> WaitForHealthAsync(int timeoutMs)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);

            while (DateTime.UtcNow < deadline)
            {
                if (await TryConnectAsync(_serverInfo))
                    return true;
                await Task.Delay(HealthCheckIntervalMs);
            }

            return false;
        }

        private async Task InitializeHttpClientAsync()
        {
            _httpClient?.Dispose();
            _httpClient = CreateHttpClient(_serverInfo);

            var password = ServerPasswordManager.GeneratePassword();
            if (!string.IsNullOrEmpty(password))
            {
                var auth = Convert.ToBase64String(Encoding.UTF8.GetBytes($"opencode:{password}"));
                _httpClient.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", auth);
            }

            await Task.CompletedTask;
        }

        private static HttpClient CreateHttpClient(ServerInfo info)
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = (_, _, _, _) => true
            };

            return new HttpClient(handler)
            {
                BaseAddress = new Uri(info.BaseUrl),
                Timeout = TimeSpan.FromSeconds(30)
            };
        }

        private void SetState(ConnectionState newState)
        {
            if (_state != newState)
            {
                _state = newState;
                StateChanged?.Invoke(newState);
            }
        }

        private static string ResolveOpenCodePath()
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c where opencode 2>nul",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using (var proc = System.Diagnostics.Process.Start(psi))
                {
                    var output = proc.StandardOutput.ReadToEnd();
                    proc.WaitForExit(3000);

                    var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var line in lines)
                    {
                        var trimmed = line.Trim();
                        if (trimmed.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase))
                            return trimmed;
                        if (trimmed.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                            return trimmed;
                    }
                }
            }
            catch { }

            // Fallback paths
            var commonPaths = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "opencode.cmd"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "nvmw", "nodejs", "opencode.cmd"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? "", "nodejs", "opencode.cmd"),
            };

            foreach (var path in commonPaths)
            {
                if (File.Exists(path))
                    return path;
            }

            return null;
        }
    }
}
