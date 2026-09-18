import type { TeamsixChatMode } from "./config";
import { newMessageId, newThreadId, newTurnId, type ToolDefinition, type TurnIdentity } from "./session-store";

export interface NormalizedRequest {
  body: Record<string, unknown>;
  identity: TurnIdentity;
  nativeCodexIdentity: boolean;
  tools: ToolDefinition[];
  modelChatMode?: TeamsixChatMode;
  clientChatMode?: TeamsixChatMode;
  imageGenerationRequested: boolean;
}

interface CodexMetadata {
  thread_id?: unknown;
  turn_id?: unknown;
  sandbox?: unknown;
  workspaces?: unknown;
  [key: string]: unknown;
}

const DEFAULT_FUNCTION_NAMESPACE = "functions";
const CHAT_MODE_SUFFIX = /@(auto|normal|temporary)$/i;

function parseChatMode(value: unknown): TeamsixChatMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === "auto" || normalized === "normal" || normalized === "temporary" ? normalized : undefined;
}

export function parseTeamsixModelSelection(model: string): { model: string; chatModeOverride?: TeamsixChatMode } {
  let trimmed = model.trim();
  const suffix = trimmed.match(CHAT_MODE_SUFFIX);
  const chatModeOverride = suffix ? parseChatMode(suffix[1]) : undefined;
  if (suffix) trimmed = trimmed.slice(0, suffix.index).trim();
  if (trimmed.startsWith("teamsix/")) trimmed = trimmed.slice("teamsix/".length);
  else if (trimmed.startsWith("cgw/")) trimmed = trimmed.slice("cgw/".length);
  return { model: trimmed, ...(chatModeOverride ? { chatModeOverride } : {}) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readCodexMetadata(body: Record<string, unknown>): CodexMetadata | undefined {
  const metadata = asRecord(body.client_metadata);
  const raw = metadata?.["x-codex-turn-metadata"];
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw)) as CodexMetadata | undefined;
    } catch {
      return undefined;
    }
  }
  return asRecord(raw) as CodexMetadata | undefined;
}

function resolveIdentity(body: Record<string, unknown>): { identity: TurnIdentity; native: boolean; metadata: CodexMetadata } {
  const existing = readCodexMetadata(body);
  const nativeThreadId = typeof existing?.thread_id === "string" && existing.thread_id.trim()
    ? existing.thread_id.trim()
    : undefined;
  const nativeTurnId = typeof existing?.turn_id === "string" && existing.turn_id.trim()
    ? existing.turn_id.trim()
    : undefined;
  const threadId = nativeThreadId ?? newThreadId();
  const turnId = nativeTurnId ?? newTurnId();
  const native = Boolean(nativeThreadId && nativeTurnId);
  return {
    identity: { threadId, turnId },
    native,
    metadata: {
      ...(existing ?? {}),
      thread_id: threadId,
      turn_id: turnId,
      sandbox: existing?.sandbox ?? "none",
      workspaces: existing?.workspaces ?? {},
    },
  };
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === "string") return { type: "input_text", text: item };
      return asRecord(item) ?? { type: "input_text", text: String(item) };
    });
  }
  return [{ type: "input_text", text: content == null ? "" : String(content) }];
}

function normalizeInput(
  input: unknown,
  turnId: string,
  preserveNativeProvenance: boolean,
): Array<Record<string, unknown>> {
  const source = typeof input === "string"
    ? [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }]
    : Array.isArray(input)
      ? input
      : [];

  return source.map((raw, index) => {
    const existing = asRecord(raw);
    const item = existing ?? {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: String(raw) }],
    };

    // Native Codex history already carries authoritative ids and per-message turn provenance.
    // Historical messages may belong to older turns; never stamp the current turn over them.
    if (preserveNativeProvenance && existing) return { ...item };

    if (item.type !== "message") return { ...item };
    return {
      ...item,
      id: typeof item.id === "string" && item.id ? item.id : `${newMessageId()}_${index}`,
      role: typeof item.role === "string" ? item.role : "user",
      content: normalizeContent(item.content),
      internal_chat_message_metadata_passthrough: {
        ...(asRecord(item.internal_chat_message_metadata_passthrough) ?? {}),
        turn_id: turnId,
      },
    };
  });
}

function namespaceName(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value !== DEFAULT_FUNCTION_NAMESPACE
    ? value.trim()
    : undefined;
}

function toolParameters(tool: Record<string, unknown>): unknown {
  return tool.parameters
    ?? tool.input_schema
    ?? { type: "object", properties: {} };
}

function functionTool(tool: Record<string, unknown>, namespace?: string): ToolDefinition | undefined {
  const nested = asRecord(tool.function);
  const source = nested ?? tool;
  const nativeName = typeof source.name === "string" ? source.name.trim() : "";
  if (!nativeName) return undefined;
  const name = namespace ? `${namespace}__${nativeName}` : nativeName;
  return {
    type: "function",
    name,
    description: typeof source.description === "string" ? source.description : "",
    parameters: toolParameters(source),
    teamsixWireName: nativeName,
    teamsixWireType: "function",
    ...(namespace ? { teamsixNamespace: namespace } : {}),
  };
}

function customTool(tool: Record<string, unknown>): ToolDefinition | undefined {
  const name = typeof tool.name === "string" ? tool.name.trim() : "";
  if (!name) return undefined;
  return {
    type: "function",
    name,
    description: typeof tool.description === "string" ? tool.description : "",
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Raw input for this Codex custom/freeform tool.",
        },
      },
      required: ["input"],
      additionalProperties: false,
    },
    teamsixWireName: name,
    teamsixWireType: "custom",
  };
}

function toolSearch(tool: Record<string, unknown>): ToolDefinition {
  return {
    type: "function",
    name: "tool_search",
    description: typeof tool.description === "string"
      ? tool.description
      : "Search for additional Codex/plugin tools to load for the next tool round.",
    parameters: asRecord(tool.parameters) ?? {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for tools to load." },
        limit: { type: "number", description: "Maximum number of tools to return." },
      },
      required: ["query"],
    },
    teamsixWireName: "tool_search",
    teamsixWireType: "tool_search",
  };
}

function flattenToolSpecs(specs: unknown[]): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const raw of specs) {
    const tool = asRecord(raw);
    if (!tool) continue;

    if (tool.type === "function") {
      const mapped = functionTool(tool);
      if (mapped) out.push(mapped);
      continue;
    }

    if (tool.type === "namespace" && Array.isArray(tool.tools)) {
      const namespace = namespaceName(tool.name);
      for (const innerRaw of tool.tools) {
        const inner = asRecord(innerRaw);
        if (!inner) continue;
        if (inner.type === "function") {
          const mapped = functionTool(inner, namespace);
          if (mapped) out.push(mapped);
        } else if (tool.name === DEFAULT_FUNCTION_NAMESPACE && inner.type === "custom") {
          const mapped = customTool(inner);
          if (mapped) out.push(mapped);
        }
      }
      continue;
    }

    if (tool.type === "custom") {
      const mapped = customTool(tool);
      if (mapped) out.push(mapped);
      continue;
    }

    if (tool.type === "tool_search") {
      out.push(toolSearch(tool));
      continue;
    }

    // OpenAI-hosted tools are not local Codex capabilities and cannot be round-tripped as a
    // client-executed call through 9Router. Image generation gets its own TEAMSIX provider later.
    if (tool.type === "web_search" || tool.type === "web_search_preview" || tool.type === "image_generation") {
      continue;
    }

    // Future/unknown named client tools (including computer-use variants) are relayed as ordinary
    // function calls. Preserve their name and whichever input schema they provide.
    if (typeof tool.name === "string") {
      const mapped = functionTool(tool);
      if (mapped) out.push(mapped);
    }
  }

  const seen = new Set<string>();
  return out.filter(tool => {
    const name = typeof tool.name === "string" ? tool.name : "";
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function isImageGenerationSpec(raw: unknown): boolean {
  const tool = asRecord(raw);
  if (!tool) return false;
  if (tool.type === "image_generation") return true;
  if (typeof tool.name === "string" && ["image_gen", "imagegen", "image_generation"].includes(tool.name.trim())) return true;
  if (tool.type === "namespace" && Array.isArray(tool.tools)) {
    if (tool.name === "image_gen") return true;
    return tool.tools.some(inner => {
      const child = asRecord(inner);
      return typeof child?.name === "string" && child.name.trim() === "imagegen";
    });
  }
  return false;
}

function collectToolSpecs(body: Record<string, unknown>): unknown[] {
  const specs: unknown[] = Array.isArray(body.tools) ? [...body.tools] : [];
  if (!Array.isArray(body.input)) return specs;

  for (const raw of body.input) {
    const item = asRecord(raw);
    if (!item) continue;
    if (item.type === "additional_tools" && Array.isArray(item.tools)) {
      specs.push(...item.tools);
    }
    if (item.type === "tool_search_output" && Array.isArray(item.tools)) {
      specs.push(...item.tools);
    }
  }
  return specs;
}

export function normalizeResponsesRequest(raw: unknown): NormalizedRequest {
  const body = structuredClone(asRecord(raw) ?? {});
  const { identity, native, metadata } = resolveIdentity(body);

  if (!native) {
    const clientMetadata = asRecord(body.client_metadata) ?? {};
    body.client_metadata = {
      ...clientMetadata,
      "x-codex-turn-metadata": JSON.stringify(metadata),
    };
  }

  body.input = normalizeInput(body.input, identity.turnId, native);
  body.stream = body.stream === true;
  const specs = collectToolSpecs(body);
  const tools = flattenToolSpecs(specs);
  const selection = typeof body.model === "string" ? parseTeamsixModelSelection(body.model) : { model: "" };
  const clientMetadata = asRecord(body.client_metadata);
  const clientChatMode = parseChatMode(clientMetadata?.["x-teamsix-chat-mode"]);

  return {
    body,
    identity,
    nativeCodexIdentity: native,
    tools,
    ...(selection.chatModeOverride ? { modelChatMode: selection.chatModeOverride } : {}),
    ...(clientChatMode ? { clientChatMode } : {}),
    imageGenerationRequested: specs.some(isImageGenerationSpec),
  };
}

export function mapTeamsixModelToUpstream(model: string): string {
  return parseTeamsixModelSelection(model).model;
}
