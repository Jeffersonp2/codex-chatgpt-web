# Provider mode for 9Router

This fork adds a local provider bridge for using ChatGPT Web models behind 9Router without letting `codex-chatgpt-web` own Codex's `openai_base_url`.

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

## Requirements

The normal `codex-chatgpt-web` launcher/daemon must already be configured and running so the browser session is authenticated.

The provider bridge reads the existing `~/.codex-chatgpt-web/config.json` configuration and does not modify Codex configuration.

## Start provider mode

From the repository:

```powershell
bun run provider
```

Default provider URL:

```text
http://127.0.0.1:11435/v1
```

Default upstream daemon URL:

```text
http://127.0.0.1:17841/v1
```

Change the provider port if required:

```powershell
$env:CODEX_WEB_PROVIDER_PORT="11435"
bun run provider
```

Optional local API key:

```powershell
$env:CODEX_WEB_PROVIDER_API_KEY="change-me"
bun run provider
```

When no API key is configured, the bridge is still bound to `127.0.0.1` only.

## 9Router configuration

Create an OpenAI-compatible provider that uses the Responses API.

```text
Name: ChatGPT Web Local
Base URL: http://127.0.0.1:11435/v1
API key: change-me   (only if CODEX_WEB_PROVIDER_API_KEY is set)
Protocol: OpenAI Responses
```

The provider exposes only the `chatgpt-web/*` model namespace. It does not expose or proxy native OpenAI models because 9Router should remain the only router.

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
Invoke-RestMethod http://127.0.0.1:11435/healthz
```

Models:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/v1/models
```

The provider bridge deliberately rejects `/v1/chat/completions`. Configure 9Router to send `/v1/responses`; converting Codex traffic to legacy Chat Completions may discard metadata required by the browser-backed harness.

## Safety boundary

Provider mode is local-only by default and strips the provider Authorization header before forwarding requests to the internal `codex-chatgpt-web` daemon. A local 9Router API key therefore cannot accidentally be forwarded as an OpenAI credential.
