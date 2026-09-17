# TEAMSIX AI Bridge

A local OpenAI Responses-compatible provider designed to sit behind 9Router and reuse the existing `codex-chatgpt-web` browser runtime without making that runtime own Codex routing.

## Architecture

```text
Codex / Cursor / other Responses clients
                 |
                 v
              9Router
                 |
                 v
        TEAMSIX AI Bridge :11436
          |             |
          |             +--> Plugin Hub (optional HTTP plugins)
          |
          v
 codex-chatgpt-web :17841
          |
          v
      ChatGPT Web
```

Responsibilities:

- **9Router** owns provider selection, API keys, routing, quotas and aliases.
- **TEAMSIX AI Bridge** owns ChatGPT Web request normalization, session/turn identity, tool translation and optional plugins.
- **Codex** remains the executor for local filesystem, terminal, build, Git and project tools.
- **codex-chatgpt-web** remains the browser transport to ChatGPT Web.

## Why this fixes the current integration

The browser adapter requires native Codex `thread_id` / `turn_id` metadata. TEAMSIX preserves real Codex metadata when present and synthesizes valid identities for generic Responses clients. In `bridge` tool mode, the model is given a strict tool contract and TEAMSIX converts a requested local action back into a native Responses `function_call`, so Codex can execute the tool on the user's machine without requiring the ChatGPT `Codex Native2` connector.

## Run

Requirements: Bun 1.4+ and a running `codex-chatgpt-web` daemon on `http://127.0.0.1:17841`.

```powershell
cd D:\LLMs\codex-chatgpt-web
git fetch origin
git switch feature/teamsix-ai-bridge
git pull

cd .\teamsix-ai-bridge
bun install
bun run typecheck
bun test
bun run start
```

Defaults:

- API: `http://127.0.0.1:11436/v1`
- Dashboard: `http://127.0.0.1:11436/`
- ChatGPT Web upstream: `http://127.0.0.1:17841/v1`
- Tool mode: `bridge`

## 9Router provider

Create an OpenAI-compatible provider using **Responses API**:

- Name: `TEAMSIX AI Bridge`
- Prefix: `teamsix`
- Base URL: `http://127.0.0.1:11436/v1`
- API key: blank unless `TEAMSIX_API_KEY` is configured
- Default model: `teamsix/chatgpt-web/high`

Import `/models`. The public model IDs are dynamically derived from the ChatGPT Web upstream and are exposed as `teamsix/chatgpt-web/*`.

## Direct test

```powershell
$Body = @{
  model = "teamsix/chatgpt-web/high"
  input = "Responda exatamente: TEAMSIX OK"
  stream = $false
} | ConvertTo-Json -Depth 20

Invoke-RestMethod `
  -Uri "http://127.0.0.1:11436/v1/responses" `
  -Method POST `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 30
```

Unlike a direct request to the old provider, this request receives synthesized Codex turn identity metadata.

## Tool mode

`TEAMSIX_TOOLS_MODE=bridge` is the new mode. Incoming Codex tools are not sent to ChatGPT Web as native MCP tools. Instead:

1. TEAMSIX advertises the available tool schemas to the browser model in a strict local tool contract.
2. ChatGPT asks for a tool using `TEAMSIX_TOOL_CALL:{...}`.
3. For a Codex/local tool, TEAMSIX converts it to a Responses `function_call`.
4. Codex executes it locally with its normal permission model.
5. The next `function_call_output` is translated back into browser context and ChatGPT continues.

`passthrough` keeps the original Full MCP behavior for accounts/workspaces where the native connector is available. `off` strips tools completely.

## Plugin Hub

Copy `plugins.example.json` to `plugins.json`. HTTP plugins are intentionally declarative and secrets are read only from environment variables.

Each plugin tool is exposed internally as:

```text
plugin__<plugin-id>__<tool-name>
```

Plugin tools are executed by TEAMSIX itself. Local machine tools should normally stay in Codex, not in the Plugin Hub.

The dashboard shows plugin state and can reload `plugins.json` without restarting the process.

## Security defaults

- Listener defaults to loopback only.
- No provider key is required unless `TEAMSIX_API_KEY` is explicitly set.
- Plugin secrets are not stored in `plugins.json`; only the environment-variable name is stored.
- Arbitrary shell execution is not implemented in the Plugin Hub. Local execution remains under Codex permissions.
- The bridge never changes Codex `openai_base_url`; 9Router remains the owner of that route.
