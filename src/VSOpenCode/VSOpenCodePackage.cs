using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using VSOpenCode.Commands;
using VSOpenCode.Services;

namespace VSOpenCode
{
    [Guid("B1C2D3E4-F5A6-7890-BCDE-F12345678901")]
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("#110", "#112", "1.0", IconResourceID = 400)]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(OpenCodeToolWindow))]
    [ProvideAutoLoad(UIContextGuids80.NoSolution, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]
    public sealed class VSOpenCodePackage : AsyncPackage
    {
        public const string PackageGuidString = "B1C2D3E4-F5A6-7890-BCDE-F12345678901";

        private DTE _dte;
        private SolutionEvents _solutionEvents;

        /// <summary>
        /// Shared server controller — survives across tool window open/close.
        /// </summary>
        private ServerController _serverController;

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress);
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            _serverController = new ServerController();

            await ShowOpenCodeWindowCommand.InitializeAsync(this);

            _dte = await GetServiceAsync(typeof(DTE)) as DTE;
            if (_dte != null)
            {
                _solutionEvents = _dte.Events.SolutionEvents;
                _solutionEvents.Opened += OnSolutionOpened;
            }
        }

        private void OnSolutionOpened()
        {
            _ = JoinableTaskFactory.RunAsync(async () =>
            {
                await JoinableTaskFactory.SwitchToMainThreadAsync();
                await Task.Delay(1000);
                await RefreshOpenCodeWindowAsync();
            });
        }

        internal async Task ShowOpenCodeWindowAsync()
        {
            var window = await ShowToolWindowAsync(
                typeof(OpenCodeToolWindow), 0, create: true, DisposalToken);

            if (window is OpenCodeToolWindow toolWindow && toolWindow?.Control != null)
            {
                toolWindow.SetServiceProvider(this);
                toolWindow.Control.SetServerController(_serverController);

                if (!_serverController.TryAcquire(toolWindow))
                {
                    // Another window already owns the controller — just show this one
                    System.Diagnostics.Debug.WriteLine("Server controller owned by another window");
                }

                await toolWindow.Control.StartAsync();
            }
        }

        internal async Task RefreshOpenCodeWindowAsync()
        {
            var window = await FindToolWindowAsync(
                typeof(OpenCodeToolWindow), 0, false, DisposalToken);

            if (window is OpenCodeToolWindow toolWindow && toolWindow?.Control != null)
            {
                toolWindow.Control.SetServerController(_serverController);
                _serverController.TryAcquire(toolWindow);
                await toolWindow.Control.StartAsync();
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _serverController?.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
