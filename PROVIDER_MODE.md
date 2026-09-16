# Provider mode for 9Router

This fork adds a local provider bridge for using ChatGPT Web models behind 9Router without requiring 9Router to talk directly to the ChatGPT browser transport.

## Architecture

```text
Codex
  |
  v
9Router
  |-- Ollama / other providers
  `-- ChatGPT Web provider -> http://127.0.0.1:11435/v1
                               |
                               v
                         codex-chatgpt-web daemon
                         http://127.0.0.1:17841/v1
                               |
                               v
                           ChatGPT Web
```

The provider bridge intentionally keeps the native OpenAI Responses protocol. This preserves Codex turn metadata, streaming, reasoning events, tool metadata and compaction requests.

## Single-process runtime

The normal runtime now starts both local endpoints in one process:

```powershell
bun run start
```

or equivalently:

```powershell
bun run 9router
```

Expected output:

```text
codex-chatgpt-web 5.0.7 listening on http://127.0.0.1:17841/v1 (full)
9Router provider listening on http://127.0.0.1:11435/v1
```

`17841` is the internal ChatGPT Web Responses daemon. `11435` is the provider endpoint intended for 9Router.

The standalone diagnostic command remains available:

```powershell
bun run provider
```

It is normally unnecessary once the combined runtime is used.

## Desktop launcher, tray and Windows startup

The existing Electron launcher supervises the same packaged runtime, so the provider endpoint is started automatically together with the normal daemon.

The launcher already supports:

- Windows system tray operation;
- keeping the runtime active when the main window is closed;
- starting at Windows login with `--hidden`;
- restarting the supervised runtime after failures.

The packaged launcher uses the combined runtime entrypoint, so no PowerShell window is required for normal use.

For a new launcher profile, `Launch at login` and `Keep running on close` default to enabled. If either setting was disabled previously, enable it again in Launcher Settings.

## Build the Windows app

Install the launcher dependencies once:

```powershell
cd D:\LLMs\codex-chatgpt-web\launcher
bun install --frozen-lockfile
```

Then build the Windows installer from the repository root:

```powershell
cd D:\LLMs\codex-chatgpt-web
bun run app:package
```

The Windows installer is written under:

```text
D:\LLMs\codex-chatgpt-web\launcher\release\
```

Install it normally. After setup, keep `Launch at login` and `Keep running on close` enabled. Closing the main window leaves the app in the system tray and keeps both `17841` and `11435` available.

## Provider endpoint

Default provider URL:

```text
http://127.0.0.1:11435/v1
```

Change the provider port if required:

```powershell
$env:CODEX_WEB_PROVIDER_PORT="11435"
bun run start
```

Optional local API key:

```powershell
$env:CODEX_WEB_PROVIDER_API_KEY="change-me"
bun run start
```

When no API key is configured, the bridge is still bound to `127.0.0.1` only.

## 9Router configuration

Create an OpenAI-compatible provider that uses the Responses API.

```text
Name: ChatGPT Web
Prefix: cgw
API Type: Responses
Base URL: http://127.0.0.1:11435/v1
API Key: local
```

The provider exposes only the `chatgpt-web/*` model namespace. It does not expose or proxy native OpenAI models because 9Router should remain the router in front of this provider.

Typical model IDs are:

```text
chatgpt-web/light
chatgpt-web/medium
chatgpt-web/high
chatgpt-web/xhigh
chatgpt-web/pro
```

The exact list depends on the ChatGPT account capabilities discovered by the launcher.

## Test

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/healthz | ConvertTo-Json -Depth 10
```

Models:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/v1/models | ConvertTo-Json -Depth 10
```

The provider bridge deliberately rejects `/v1/chat/completions`. Configure 9Router to send `/v1/responses`; converting Codex traffic to legacy Chat Completions may discard metadata required by the browser-backed harness.

## Safety boundary

Provider mode is local-only by default and strips the provider Authorization header before forwarding requests to the internal `codex-chatgpt-web` daemon. A local 9Router API key therefore cannot accidentally be forwarded as an OpenAI credential.
