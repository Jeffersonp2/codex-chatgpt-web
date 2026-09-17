# TEAMSIX AI Bridge

TEAMSIX AI Bridge is a desktop OpenAI Responses-compatible bridge built specifically for this route:

```text
ChatGPT Codex
      |
      v
   9Router
      |
      v
TEAMSIX AI Bridge :11436
      |
      +-- ChatGPT Web browser/login/runtime (embedded)
      +-- Codex tool + plugin relay
      +-- sessions / compaction / streaming
      +-- optional TEAMSIX HTTP Plugin Hub
      |
      v
 ChatGPT Web
```

## One user-facing app

The final desktop package is **TEAMSIX AI Bridge**. You do not need to launch a separate `codex-chatgpt-web` application.

Internally TEAMSIX reuses the proven browser/runtime code from this fork. The internal transport may still use a private loopback port, but its lifecycle is owned by TEAMSIX and is not a separate app the user has to install, configure, or start.

Responsibilities:

- **ChatGPT Codex** remains the local executor: filesystem, terminal, Git, builds, Computer Use and every tool/plugin that Codex exposes in the Responses request.
- **9Router** remains the only router/provider manager and keeps ownership of Codex's API route.
- **TEAMSIX AI Bridge** owns ChatGPT Web login/browser transport, request normalization, turn/session identity, context/compaction, streaming and the tool relay.
- **ChatGPT Web** is the model/browser backend.

## Why tools and Codex plugins can work without Codex Native2

The embedded ChatGPT transport runs in `browser-only` mode. TEAMSIX receives the original Responses `tools` array from Codex and converts it into a strict browser-model tool contract.

When ChatGPT Web chooses a Codex/local tool:

```text
ChatGPT Web
   |
   | TEAMSIX_TOOL_CALL
   v
TEAMSIX
   |
   | Responses function_call
   v
9Router
   |
   v
Codex executes the real tool/plugin locally
   |
   | function_call_output
   v
9Router -> TEAMSIX -> ChatGPT Web continues
```

This means the ChatGPT custom connector `Codex Native2` is not required for TEAMSIX bridge mode. Codex keeps its own permission model and remains responsible for the actual local action.

If a connected Codex plugin itself is not authenticated or fails to load in Codex, TEAMSIX cannot create that external authorization. Once Codex exposes the plugin/tool to the Responses turn, TEAMSIX can relay it like the other Codex tools.

## Public endpoint for 9Router

Default endpoint:

```text
http://127.0.0.1:11436/v1
```

Configure the 9Router provider as **OpenAI Responses API**.

Suggested values:

```text
Name: TEAMSIX AI Bridge
Prefix: teamsix
Base URL: http://127.0.0.1:11436/v1
API key: blank unless TEAMSIX_API_KEY is configured
Default model: chatgpt-web/high
```

The public provider accepts ChatGPT Web models and 9Router may expose them with its provider prefix, for example:

```text
teamsix/chatgpt-web/light
teamsix/chatgpt-web/medium
teamsix/chatgpt-web/high
teamsix/chatgpt-web/extra-high
```

## Development module

The `teamsix-ai-bridge/` TypeScript package remains in the repository because its BridgeEngine, session store, SSE conversion, tool bridge and Plugin Hub are shared by the packaged desktop runtime.

Running `bun run start` from this directory is a developer/debug path only. The intended user installation is the packaged **TEAMSIX AI Bridge** Electron application, which starts its embedded ChatGPT Web transport automatically.

## Plugin Hub

The optional TEAMSIX Plugin Hub supports declarative HTTP tools. Copy `plugins.example.json` to `plugins.json` for development. Secrets are referenced by environment-variable name and are not stored in the JSON configuration.

Plugin tools use names like:

```text
plugin__<plugin-id>__<tool-name>
```

This Plugin Hub supplements the tools/plugins already supplied by Codex; it does not replace them.

## Security defaults

- Public provider and internal transport bind to loopback by default.
- 9Router remains the owner of the Codex route; TEAMSIX never needs to rewrite `openai_base_url`.
- The embedded transport is forced to connector-free `browser-only` mode in TEAMSIX/9Router operation.
- Local filesystem/terminal execution remains under Codex permissions rather than being implemented as arbitrary shell execution in the Plugin Hub.
- The custom TEAMSIX build disables the original upstream self-updater so it cannot overwrite TEAMSIX with a stock `codex-chatgpt-web` release.
