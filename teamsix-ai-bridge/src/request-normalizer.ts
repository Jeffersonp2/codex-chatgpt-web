import { newMessageId, newThreadId, newTurnId, type ToolDefinition, type TurnIdentity } from "./session-store";

export interface NormalizedRequest {
  body: Record<string, unknown>;
  identity: TurnIdentity;
  nativeCodexIdentity: boolean;
  tools: ToolDefinition[];
}

interface CodexMetadata {
  thread_id?: unknown;
  turn_id?: unknown;
  sandbox?: unknown;
  workspaces?: unknown;
  [key: string]: unknown;
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
  const threadId = typeof existing?.thread_id === "string" && existing.thread_id.trim()
    ? existing.thread_id.trim()
    : newThreadId();
  const turnId = typeof existing?.turn_id === "string" && existing.turn_id.trim()
    ? existing.turn_id.trim()
    : newTurnId();
  const native = Boolean(
    typeof existing?.thread_id === "string" && existing.thread_id.trim()
    && typeof existing?.turn_id === "string" && existing.turn_id.trim(),
  );
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

function normalizeInput(input: unknown, turnId: string): Array<Record<string, unknown>> {
  const source = typeof input === "string"
    ? [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }]
    : Array.isArray(input)
      ? input
      : [];

  return source.map((raw, index) => {
    const item = asRecord(raw) ?? {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: String(raw) }],
    };
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

function normalizeTools(value: unknown): ToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => asRecord(item)).filter((item): item is ToolDefinition => Boolean(item));
}

export function normalizeResponsesRequest(raw: unknown): NormalizedRequest {
  const body = structuredClone(asRecord(raw) ?? {});
  const { identity, native, metadata } = resolveIdentity(body);
  const clientMetadata = asRecord(body.client_metadata) ?? {};
  body.client_metadata = {
    ...clientMetadata,
    "x-codex-turn-metadata": JSON.stringify(metadata),
  };
  body.input = normalizeInput(body.input, identity.turnId);
  body.stream = body.stream === true;
  const tools = normalizeTools(body.tools);

  return {
    body,
    identity,
    nativeCodexIdentity: native,
    tools,
  };
}

export function mapTeamsixModelToUpstream(model: string): string {
  const trimmed = model.trim();
  if (trimmed.startsWith("teamsix/")) return trimmed.slice("teamsix/".length);
  if (trimmed.startsWith("cgw/")) return trimmed.slice("cgw/".length);
  return trimmed;
}
