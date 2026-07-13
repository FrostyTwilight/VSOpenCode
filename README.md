# Visual Studio OpenCode

A Visual Studio 2022 extension that integrates [OpenCode](https://opencode.ai) as a tool window via WebView2.

## Features

- **WebView2 Tool Window** — OpenCode web interface embedded directly in VS
- **Auto Server Detection** — Dynamically resolves `opencode serve` port from process output
- **Session Management** — Creates/finds sessions per project via OpenCode HTTP API
- **Project Sidebar Injection** — Injects project into OpenCode localStorage for sidebar visibility
- **Server Controller** — Decoupled server lifecycle, survives tool window close (5-min idle timeout)
- **Smart Shutdown** — Waits for agent to finish before shutting down; resets on re-open
- **Multi-language** — EN / zh-Hans via .NET satellite assemblies
- **Solution Auto-refresh** — Detects solution/folder changes and reconnects

## Requirements

| Component | Version |
|-----------|---------|
| Visual Studio | 2022 (17.0+) |
| OpenCode CLI | — installed and in PATH |
| .NET Framework | 4.7.2 |

## Installation

1. Download the `.vsix` from [Releases](https://github.com/DreamBoxSpy/VSOpenCode/releases)
2. Close all VS instances, double-click the `.vsix`
3. Open VS → **View → Other Windows → OpenCode**

## Build

### In Visual Studio

```
Open VSOpenCode.sln → Build → F5 (experimental instance)
```

### CLI

```bash
dotnet build src/VSOpenCode/VSOpenCode.csproj -c Release
```

## Architecture

```
VSOpenCodePackage
├── ServerController (singleton, shared across windows)
│   ├── OpenCodeServerService   → opencode serve process
│   ├── OpenCodeSessionService  → /session, /project HTTP API
│   ├── ConnectionMonitor       → periodic health checks
│   └── 5-min idle shutdown timer
│
├── OpenCodeToolWindow          → ToolWindowPane
│   └── OpenCodeToolWindowControl → UserControl
│       ├── WebView2            → renders OpenCode web UI
│       ├── ProjectRootResolver → DTE/git root detection
│       ├── ErrorPage.html      → embedded resource
│       └── InjectProject.js    → localStorage injection
│
└── ShowOpenCodeWindowCommand   → View > Other Windows menu
```

## Project Structure

```
src/VSOpenCode/
├── Commands/           # VS menu command registration
├── Models/             # API DTOs (Session, Project, Health, Path)
├── Services/           # Server, session, connection, project resolver
├── Resources/          # .resx (i18n), ErrorPage.html, InjectProject.js, Icon
├── Properties/         # AssemblyInfo
└── Controls/           # (reserved for future WPF controls)
```

## License

MIT
