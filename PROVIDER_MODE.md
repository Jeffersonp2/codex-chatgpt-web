# TEAMSIX AI Bridge / 9Router Mode

TEAMSIX is the user-facing desktop application for routing the authenticated ChatGPT Web browser backend through 9Router while preserving the native Codex Responses protocol.

```text
ChatGPT Codex
      |
      v
   9Router
      |
      v
TEAMSIX AI Bridge :11436
      |
      +-- embedded ChatGPT Web browser/login/runtime
      +-- Codex tool/plugin relay
      +-- sessions / compaction / streaming
      +-- optional TEAMSIX Plugin Hub
      |
      v
 ChatGPT Web
```

## User-facing processes

The intended setup has only three applications the user manages:

1. ChatGPT/Codex
2. 9Router
3. TEAMSIX AI Bridge

The original `codex-chatgpt-web` runtime remains reused internally, but TEAMSIX owns its lifecycle. The user does not install or start a separate Codex Web GPT application.

## Routing ownership

9Router owns the Codex route. TEAMSIX must not rewrite Codex `openai_base_url` while provider mode is enabled.

Public provider endpoint:

```text
http://127.0.0.1:11436/v1
```

Use **OpenAI Responses API** in 9Router.

## Embedded browser transport

TEAMSIX starts the existing browser/runtime internally and forces it to `browser-only` + automatic mode. This deliberately removes the requirement for the ChatGPT `Codex Native2` connector in normal TEAMSIX operation.

The embedded transport may use an internal loopback endpoint such as `127.0.0.1:17841`; that endpoint is an implementation detail and is started/stopped by TEAMSIX.

## Codex tools and plugins

TEAMSIX receives the original `tools` array and Codex turn metadata from the Responses request. In default `bridge` mode it:

1. preserves native Codex `thread_id` and `turn_id` when supplied;
2. synthesizes valid identities for generic Responses clients when necessary;
3. removes native tools from the browser-only upstream request;
4. gives ChatGPT Web a strict TEAMSIX tool-selection contract;
5. translates a selected Codex/local tool into a native Responses `function_call`;
6. returns that function call through 9Router to Codex;
7. accepts the resulting `function_call_output` and resumes the ChatGPT Web turn.

Therefore filesystem, terminal, Git, builds, Computer Use and connected Codex plugins remain executed by Codex under its own permissions. TEAMSIX does not need arbitrary local shell access for this relay.

A plugin that is itself disconnected or unauthorized in Codex still needs to be connected there. TEAMSIX can relay only tools that Codex exposes to the turn.

## Optional TEAMSIX Plugin Hub

TEAMSIX can additionally expose declarative HTTP tools from `plugins.json`. Secrets are referenced through environment variables. This is additive to Codex tools/plugins, not a replacement.

## Model namespace

The TEAMSIX provider accepts the ChatGPT Web namespace and also understands provider prefixes used during development:

```text
chatgpt-web/light
chatgpt-web/medium
chatgpt-web/high
chatgpt-web/extra-high
```

9Router can expose these under a provider prefix such as:

```text
teamsix/chatgpt-web/high
```

## Provider settings migration

The earlier experimental 9Router provider used port `11435`. TEAMSIX uses `11436`. Existing persisted provider settings using `11435` are migrated in memory to `11436` by the TEAMSIX runtime/launcher.

## Updates

The original upstream self-updater is disabled in the TEAMSIX packaged build so an upstream Codex Web GPT release cannot overwrite the custom TEAMSIX application. TEAMSIX updates should be built and distributed from this fork/project instead.
