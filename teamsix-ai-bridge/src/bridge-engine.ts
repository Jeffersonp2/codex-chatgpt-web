import type { BridgeConfig } from "./config";
import { PluginHub } from "./plugin-hub";
import { mapTeamsixModelToUpstream, normalizeResponsesRequest } from "./request-normalizer";
import { SessionStore, newMessageId, type BridgeSession, type ToolDefinition } from "./session-store";
import {
  extractResponseText,
  makeToolContractMessage,
  parseToolCall,
  synthesizeFunctionCallResponse,
  translateToolOutputsForBrowser,
} from "./tool-bridge";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export interface BridgeEngineResult {
  status: number;
  payload: Record<string, unknown>;
  streamRequested: boolean;
  nativeCodexIdentity: boolean;
  threadId: string;
  turnId: string;
}

function insertToolContract(
  input: Array<Record<string, unknown>>,
  contract: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  if (!contract) return input;
  let lastUser = -1;
  for (let i = input.length - 1; i >= 0; i--) {
    if (input[i]?.type === "message" && input[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return [...input, contract];
  return [...input.slice(0, lastUser), contract, ...input.slice(lastUser)];
}

function pluginResultMessage(turnId: string, callId: string, name: string, value: unknown): Record<string, unknown> {
  return {
    type: "message",
    id: newMessageId(),
    role: "user",
    content: [{
      type: "input_text",
      text: `<teamsix_plugin_result call_id=${JSON.stringify(callId)} tool=${JSON.stringify(name)}>\n${typeof value === "string" ? value : JSON.stringify(value)}\n</teamsix_plugin_result>`,
    }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  };
}

function localToolNames(tools: ToolDefinition[]): Set<string> {
  const names = new Set<string>();
  for (const tool of tools) {
    if (typeof tool.name === "string" && tool.name.trim()) names.add(tool.name.trim());
    const fn = asRecord(tool.function);
    if (typeof fn?.name === "string" && fn.name.trim()) names.add(fn.name.trim());
  }
  return names;
}

export class BridgeEngine {
  readonly sessions: SessionStore;
  readonly plugins: PluginHub;

  constructor(readonly config: BridgeConfig) {
    this.sessions = new SessionStore(config.sessionTtlMs);
    this.plugins = new PluginHub();
  }

  async models(): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.config.chatGptWebBaseUrl}/models`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as Record<string, unknown>;
      const data = Array.isArray(json.data) ? json.data : [];
      return {
        object: "list",
        data: data.flatMap(raw => {
          const model = asRecord(raw);
          if (!model || typeof model.id !== "string" || !model.id.startsWith("chatgpt-web/")) return [];
          return [{
            ...model,
            id: `teamsix/${model.id}`,
            owned_by: "teamsix-ai-bridge",
          }];
        }),
      };
    } catch {
      const created = Math.floor(Date.now() / 1000);
      return {
        object: "list",
        data: ["light", "medium", "high", "extra-high"].map(level => ({
          id: `teamsix/chatgpt-web/${level}`,
          object: "model",
          created,
          owned_by: "teamsix-ai-bridge",
        })),
      };
    }
  }

  async health(): Promise<Record<string, unknown>> {
    let upstreamOk = false;
    let upstream: unknown = null;
    try {
      const response = await fetch(this.config.chatGptWebBaseUrl.replace(/\/v1$/, "/healthz"), {
        signal: AbortSignal.timeout(3_000),
      });
      upstreamOk = response.ok;
      upstream = response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch (error) {
      upstream = { error: error instanceof Error ? error.message : String(error) };
    }
    return {
      status: upstreamOk ? "ok" : "degraded",
      service: "teamsix-ai-bridge",
      version: "0.1.0",
      upstream_ok: upstreamOk,
      upstream,
      tools_mode: this.config.toolsMode,
      plugins: this.plugins.listPlugins(),
      sessions: this.sessions.summary().length,
    };
  }

  async run(raw: unknown): Promise<BridgeEngineResult> {
    const normalized = normalizeResponsesRequest(raw);
    const requestedModel = typeof normalized.body.model === "string"
      ? normalized.body.model
      : "teamsix/chatgpt-web/high";
    const upstreamModel = mapTeamsixModelToUpstream(requestedModel);
    if (!upstreamModel.startsWith("chatgpt-web/")) {
      return {
        status: 400,
        streamRequested: normalized.body.stream === true,
        nativeCodexIdentity: normalized.nativeCodexIdentity,
        threadId: normalized.identity.threadId,
        turnId: normalized.identity.turnId,
        payload: {
          error: {
            type: "invalid_request_error",
            code: "unsupported_model",
            message: `TEAMSIX AI Bridge accepts only teamsix/chatgpt-web/* or chatgpt-web/* models; received ${JSON.stringify(requestedModel)}`,
          },
        },
      };
    }

    const streamRequested = normalized.body.stream === true;
    const session = this.sessions.resolve(normalized.identity);
    const pluginTools = this.config.toolsMode === "bridge" ? this.plugins.listTools() : [];
    const incomingTools = normalized.tools;
    this.sessions.setTools(session.threadId, incomingTools);

    let body = structuredClone(normalized.body);
    body.model = upstreamModel;
    body.stream = false;

    if (this.config.toolsMode === "bridge") {
      let input = translateToolOutputsForBrowser(body.input, session, normalized.identity.turnId);
      if (Array.isArray(body.input)) {
        for (const rawItem of body.input) {
          const item = asRecord(rawItem);
          if (item?.type === "function_call_output" && typeof item.call_id === "string") {
            this.sessions.consumePendingCall(session.threadId, item.call_id);
          }
        }
      }
      const allTools: ToolDefinition[] = [...incomingTools, ...pluginTools];
      const contract = makeToolContractMessage(allTools, normalized.identity.turnId);
      input = insertToolContract(input, contract);
      body.input = input;
      delete body.tools;
      delete body.tool_choice;
      delete body.parallel_tool_calls;
    } else if (this.config.toolsMode === "off") {
      delete body.tools;
      delete body.tool_choice;
      delete body.parallel_tool_calls;
    }

    const localNames = localToolNames(incomingTools);
    const allTools: ToolDefinition[] = [...incomingTools, ...pluginTools];
    const maxPluginRounds = 8;

    for (let round = 0; round <= maxPluginRounds; round++) {
      const upstream = await this.fetchUpstream(body);
      const payload = upstream.payload;
      if (upstream.status < 200 || upstream.status >= 300 || payload.status === "failed") {
        return {
          status: upstream.status,
          payload: { ...payload, model: requestedModel },
          streamRequested,
          nativeCodexIdentity: normalized.nativeCodexIdentity,
          threadId: session.threadId,
          turnId: normalized.identity.turnId,
        };
      }

      if (this.config.toolsMode !== "bridge") {
        return {
          status: upstream.status,
          payload: { ...payload, model: requestedModel },
          streamRequested,
          nativeCodexIdentity: normalized.nativeCodexIdentity,
          threadId: session.threadId,
          turnId: normalized.identity.turnId,
        };
      }

      const text = extractResponseText(payload);
      const toolCall = parseToolCall(text, allTools);
      if (!toolCall) {
        return {
          status: upstream.status,
          payload: { ...payload, model: requestedModel },
          streamRequested,
          nativeCodexIdentity: normalized.nativeCodexIdentity,
          threadId: session.threadId,
          turnId: normalized.identity.turnId,
        };
      }

      if (this.plugins.isPluginTool(toolCall.name)) {
        if (round === maxPluginRounds) {
          return {
            status: 508,
            streamRequested,
            nativeCodexIdentity: normalized.nativeCodexIdentity,
            threadId: session.threadId,
            turnId: normalized.identity.turnId,
            payload: {
              error: {
                type: "server_error",
                code: "plugin_loop_limit",
                message: `TEAMSIX plugin loop exceeded ${maxPluginRounds} internal rounds`,
              },
            },
          };
        }
        let args: unknown = {};
        try { args = JSON.parse(toolCall.arguments); } catch { args = { input: toolCall.arguments }; }
        const callId = `plugin_${crypto.randomUUID().replaceAll("-", "")}`;
        let result: unknown;
        try {
          result = await this.plugins.invoke(toolCall.name, args);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        const input = Array.isArray(body.input) ? body.input as Array<Record<string, unknown>> : [];
        body.input = [...input, pluginResultMessage(normalized.identity.turnId, callId, toolCall.name, result)];
        continue;
      }

      if (localNames.has(toolCall.name)) {
        const synthetic = synthesizeFunctionCallResponse(payload, toolCall);
        this.sessions.addPendingCall(session.threadId, synthetic.pending);
        return {
          status: 200,
          payload: { ...synthetic.response, model: requestedModel },
          streamRequested,
          nativeCodexIdentity: normalized.nativeCodexIdentity,
          threadId: session.threadId,
          turnId: normalized.identity.turnId,
        };
      }

      return {
        status: 502,
        streamRequested,
        nativeCodexIdentity: normalized.nativeCodexIdentity,
        threadId: session.threadId,
        turnId: normalized.identity.turnId,
        payload: {
          error: {
            type: "server_error",
            code: "unknown_tool_call",
            message: `ChatGPT requested a tool that is not available through TEAMSIX: ${toolCall.name}`,
          },
        },
      };
    }

    throw new Error("Unreachable TEAMSIX bridge loop state");
  }

  private async fetchUpstream(body: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
    try {
      const response = await fetch(`${this.config.chatGptWebBaseUrl}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as Record<string, unknown>
        : {
            error: {
              type: "server_error",
              code: "invalid_upstream_response",
              message: await response.text(),
            },
          };
      return { status: response.status, payload };
    } catch (error) {
      return {
        status: 502,
        payload: {
          error: {
            type: "server_error",
            code: "chatgpt_web_unavailable",
            message: `ChatGPT Web upstream unavailable: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
      };
    }
  }
}
