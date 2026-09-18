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

function findTool(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find(tool => toolName(tool) === name);
}

export function makeToolContractMessage(tools: ToolDefinition[], turnId: string): Record<string, unknown> | undefined {
  const catalog = printableTools(tools);
  if (catalog.length === 0) return undefined;
  const text = [
    "<teamsix_tool_contract>",
    "You have access to the local client tools listed below. The TEAMSIX bridge, not ChatGPT, executes them.",
    "These tools may include Codex filesystem/terminal tools, Computer Use, skills, MCP namespaces and connected Codex plugins.",
    "When a tool is required, do not claim that you executed it and do not fabricate its result.",
    "Infer tool use from the user's ordinary natural-language request. Never require the user to name exec_command, MCP, function_call, or another internal tool protocol.",
    "When exec_command exposes sandbox_permissions, prefer use_default. Request escalated permissions only after a real permission failure or when the requested action inherently requires them.",
    `Return exactly one line in this format and nothing else: ${TOOL_SENTINEL}:{\"name\":\"tool_name\",\"arguments\":{...}}`,
    `The payload after ${TOOL_SENTINEL}: MUST be valid JSON accepted by JSON.parse.`,
    "Do not Markdown-escape underscores in the sentinel, tool name, or arguments. Write TEAMSIX_TOOL_CALL and names such as exec_command literally, never TEAMSIX\\_TOOL\\_CALL or exec\\_command.",
    "For Windows paths prefer forward slashes, for example D:/LLMs/file.txt.",
    "If a backslash is necessary inside a JSON string it MUST be escaped as \\\\.",
    "For exec_command prefer semicolons between PowerShell commands instead of JSON newline escapes.",
    "Use the tool name exactly as listed. Namespaced plugin/MCP tools are already flattened to their exact TEAMSIX-visible name.",
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

export interface ParsedToolCall {
  name: string;
  arguments: string;
}

export function containsToolCallSentinel(text: string): boolean {
  return text.replaceAll("\\_", "_").includes(`${TOOL_SENTINEL}:`);
}

function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function repairToolCallJsonBackslashes(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inWindowsPath = false;
  let windowsPathSingleQuoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";

    if (!inString) {
      output += char;

      if (char === '"') {
        inString = true;
      }

      continue;
    }

    if (inWindowsPath) {
      if (char === "\\") {
        output += "\\\\";
        continue;
      }

      if (windowsPathSingleQuoted && char === "'") {
        output += char;
        inWindowsPath = false;
        windowsPathSingleQuoted = false;
        continue;
      }

      if (!windowsPathSingleQuoted && char === '"') {
        output += char;
        inWindowsPath = false;
        inString = false;
        continue;
      }

      output += char;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    if (char !== "\\") {
      output += char;
      continue;
    }

    const previous = value[index - 1] ?? "";
    const drive = value[index - 2] ?? "";
    const beforeDrive = value[index - 3] ?? "";

    const beginsWindowsDrivePath =
      previous === ":"
      && /^[A-Za-z]$/.test(drive);

    if (beginsWindowsDrivePath) {
      inWindowsPath = true;
      windowsPathSingleQuoted = beforeDrive === "'";
      output += "\\\\";
      continue;
    }

    const next = value[index + 1] ?? "";

    const validJsonEscape =
      next === '"'
      || next === "\\"
      || next === "/"
      || "bfnrtu".includes(next);

    if (validJsonEscape) {
      output += char;
      escaped = true;
      continue;
    }

    // Unknown JSON escape such as \L or \c.
    // Preserve it as a literal backslash.
    output += "\\\\";
  }

  return output;
}

function parseToolCallJson(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    // ChatGPT sometimes emits Windows paths with raw backslashes.
  }

  const repaired = repairToolCallJsonBackslashes(value);

  try {
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseToolCall(text: string, tools: ToolDefinition[]): ParsedToolCall | undefined {
  // ChatGPT can Markdown-escape underscores even inside what visually looks
  // like a raw tool protocol line:
  // TEAMSIX\_TOOL\_CALL / exec\_command.
  //
  // A single backslash before "_" is not meaningful JSON escaping, so
  // normalize it before locating/parsing the TEAMSIX sentinel.
  const normalizedText = text.replaceAll("\\_", "_");
  const index = normalizedText.indexOf(`${TOOL_SENTINEL}:`);
  if (index < 0) return undefined;

  const suffix = normalizedText
    .slice(index + TOOL_SENTINEL.length + 1)
    .trim();

  const jsonText = extractFirstJsonObject(suffix);
  if (!jsonText) return undefined;

  const parsed = parseToolCallJson(jsonText);
  if (!parsed) return undefined;

  const name = typeof parsed.name === "string"
    ? parsed.name.trim()
    : "";

  if (!name) return undefined;

  const allowed = new Set(
    printableTools(tools).map(tool => String(tool.name)),
  );

  if (!allowed.has(name)) return undefined;

  const args = parsed.arguments ?? {};

  return {
    name,
    arguments: typeof args === "string"
      ? args
      : JSON.stringify(args),
  };
}

function parsedArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export function synthesizeFunctionCallResponse(
  upstreamResponse: Record<string, unknown>,
  call: ParsedToolCall,
  tools: ToolDefinition[],
): { response: Record<string, unknown>; pending: PendingToolCall } {
  const definition = findTool(tools, call.name);
  const wireType = definition?.teamsixWireType ?? "function";
  const wireName = typeof definition?.teamsixWireName === "string" && definition.teamsixWireName
    ? definition.teamsixWireName
    : call.name;
  const namespace = typeof definition?.teamsixNamespace === "string" && definition.teamsixNamespace
    ? definition.teamsixNamespace
    : undefined;
  const callId = newCallId();
  const itemId = `fc_${callId.slice(5)}`;
  const pending: PendingToolCall = {
    callId,
    name: call.name,
    arguments: call.arguments,
    wireType,
    ...(namespace ? { namespace } : {}),
    createdAt: Date.now(),
  };

  let outputItem: Record<string, unknown>;
  if (wireType === "custom") {
    const args = parsedArguments(call.arguments);
    const input = typeof args.input === "string" ? args.input : call.arguments;
    outputItem = {
      id: itemId,
      type: "custom_tool_call",
      status: "completed",
      call_id: callId,
      name: wireName,
      input,
    };
  } else if (wireType === "tool_search") {
    outputItem = {
      id: itemId,
      type: "tool_search_call",
      status: "completed",
      call_id: callId,
      arguments: parsedArguments(call.arguments),
    };
  } else {
    outputItem = {
      id: itemId,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name: wireName,
      arguments: call.arguments,
      ...(namespace ? { namespace } : {}),
    };
  }

  return {
    pending,
    response: {
      ...upstreamResponse,
      status: "completed",
      output: [outputItem],
      error: null,
      last_error: null,
    },
  };
}

function toolResultText(item: Record<string, unknown>): string {
  if (item.type === "tool_search_output") {
    return JSON.stringify({
      status: item.status ?? "completed",
      tools: Array.isArray(item.tools) ? item.tools : [],
    });
  }
  if (typeof item.output === "string") return item.output;
  return JSON.stringify(item.output ?? null);
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

    if (item.type === "function_call_output"
      || item.type === "custom_tool_call_output"
      || item.type === "tool_search_output") {
      const callId = typeof item.call_id === "string" ? item.call_id : "";
      const pending = callId ? session.pendingCalls.get(callId) : undefined;
      translated.push({
        type: "message",
        id: newMessageId(),
        role: "user",
        content: [{
          type: "input_text",
          text: `<teamsix_tool_result call_id=${JSON.stringify(callId)} tool=${JSON.stringify(pending?.name ?? "unknown")}>\n${toolResultText(item)}\n</teamsix_tool_result>`,
        }],
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      });
      continue;
    }

    // The browser model already saw the tool request through the TEAMSIX contract. Do not feed
    // native Codex call/control items to the connector-free upstream parser as executable tools.
    if (item.type === "function_call"
      || item.type === "custom_tool_call"
      || item.type === "tool_search_call"
      || item.type === "local_shell_call"
      || item.type === "additional_tools") {
      continue;
    }

    translated.push(item);
  }
  return translated;
}
