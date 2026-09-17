import { newCallId, newMessageId, type BridgeSession, type PendingToolCall, type ToolDefinition } from "./session-store";

const TOOL_SENTINEL = "TEAMSIX_TOOL_CALL";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toolName(tool: ToolDefinition): string | undefined {
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = asRecord(tool.function);
  return typeof fn?.name === "string" && fn.name.trim() ? fn.name.trim() : undefined;
}

function toolDescription(tool: ToolDefinition): string {
  if (typeof tool.description === "string") return tool.description;
  const fn = asRecord(tool.function);
  return typeof fn?.description === "string" ? fn.description : "";
}

function toolParameters(tool: ToolDefinition): unknown {
  if (tool.parameters !== undefined) return tool.parameters;
  return asRecord(tool.function)?.parameters ?? { type: "object", properties: {} };
}

function printableTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.flatMap(tool => {
    const name = toolName(tool);
    if (!name) return [];
    return [{
      name,
      description: toolDescription(tool),
      parameters: toolParameters(tool),
    }];
  });
}

export function makeToolContractMessage(tools: ToolDefinition[], turnId: string): Record<string, unknown> | undefined {
  const catalog = printableTools(tools);
  if (catalog.length === 0) return undefined;
  const text = [
    "<teamsix_tool_contract>",
    "You have access to the local client tools listed below. The TEAMSIX bridge, not ChatGPT, executes them.",
    "When a tool is required, do not claim that you executed it and do not fabricate its result.",
    `Return exactly one line in this format and nothing else: ${TOOL_SENTINEL}:{\"name\":\"tool_name\",\"arguments\":{...}}`,
    "After the client executes the tool, its real result will be provided in a later message. Then continue the task.",
    "If no tool is required, answer normally and never emit the sentinel.",
    `Available tools: ${JSON.stringify(catalog)}`,
    "</teamsix_tool_contract>",
  ].join("\n");
  return {
    type: "message",
    id: newMessageId(),
    role: "developer",
    content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  };
}

function outputAsText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(outputAsText).filter(Boolean).join("\n");
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.output_text === "string") return record.output_text;
  if (record.content !== undefined) return outputAsText(record.content);
  if (record.output !== undefined) return outputAsText(record.output);
  return "";
}

export function extractResponseText(response: unknown): string {
  return outputAsText(asRecord(response)?.output).trim();
}

interface ParsedToolCall {
  name: string;
  arguments: string;
}

export function parseToolCall(text: string, tools: ToolDefinition[]): ParsedToolCall | undefined {
  const index = text.indexOf(`${TOOL_SENTINEL}:`);
  if (index < 0) return undefined;
  const suffix = text.slice(index + TOOL_SENTINEL.length + 1).trim();
  const firstLine = suffix.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!name) return undefined;
  const allowed = new Set(printableTools(tools).map(tool => String(tool.name)));
  if (!allowed.has(name)) return undefined;
  const args = parsed.arguments ?? {};
  return { name, arguments: typeof args === "string" ? args : JSON.stringify(args) };
}

export function synthesizeFunctionCallResponse(
  upstreamResponse: Record<string, unknown>,
  call: ParsedToolCall,
): { response: Record<string, unknown>; pending: PendingToolCall } {
  const callId = newCallId();
  const itemId = `fc_${callId.slice(5)}`;
  const pending: PendingToolCall = {
    callId,
    name: call.name,
    arguments: call.arguments,
    createdAt: Date.now(),
  };
  return {
    pending,
    response: {
      ...upstreamResponse,
      status: "completed",
      output: [{
        id: itemId,
        type: "function_call",
        status: "completed",
        call_id: callId,
        name: call.name,
        arguments: call.arguments,
      }],
      error: null,
      last_error: null,
    },
  };
}

export function translateToolOutputsForBrowser(
  input: unknown,
  session: BridgeSession,
  turnId: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return [];
  const translated: Array<Record<string, unknown>> = [];
  for (const raw of input) {
    const item = asRecord(raw);
    if (!item) continue;
    if (item.type === "function_call_output") {
      const callId = typeof item.call_id === "string" ? item.call_id : "";
      const pending = callId ? session.pendingCalls.get(callId) : undefined;
      const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? null);
      translated.push({
        type: "message",
        id: newMessageId(),
        role: "user",
        content: [{
          type: "input_text",
          text: `<teamsix_tool_result call_id=${JSON.stringify(callId)} tool=${JSON.stringify(pending?.name ?? "unknown")}>\n${output}\n</teamsix_tool_result>`,
        }],
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      });
      continue;
    }
    if (item.type === "function_call") {
      continue;
    }
    translated.push(item);
  }
  return translated;
}
