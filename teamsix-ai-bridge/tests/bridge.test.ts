import { describe, expect, test } from "bun:test";
import {
  extractResponseText,
  makeToolContractMessage,
  parseToolCall,
  synthesizeFunctionCallResponse,
  translateToolOutputsForBrowser,
} from "../src/tool-bridge";
import type { BridgeSession, ToolDefinition } from "../src/session-store";

const tools: ToolDefinition[] = [{
  type: "function",
  name: "shell",
  description: "Run a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
}];

function session(): BridgeSession {
  const now = Date.now();
  return {
    threadId: "thread_1",
    lastTurnId: "turn_1",
    createdAt: now,
    updatedAt: now,
    tools,
    pendingCalls: new Map(),
  };
}

describe("tool bridge", () => {
  test("extracts text from Responses output", () => {
    expect(extractResponseText({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "hello" }],
      }],
    })).toBe("hello");
  });

  test("turns function output into browser-readable tool evidence", () => {
    const current = session();
    current.pendingCalls.set("call_1", {
      callId: "call_1",
      name: "shell",
      arguments: '{"command":"dir"}',
      wireType: "function",
      createdAt: Date.now(),
    });
    const translated = translateToolOutputsForBrowser([{
      type: "function_call_output",
      call_id: "call_1",
      output: "ok",
    }], current, "turn_1");
    expect(JSON.stringify(translated)).toContain("shell");
    expect(JSON.stringify(translated)).toContain("ok");
  });

  test("advertises declared tools to the browser model", () => {
    const message = makeToolContractMessage(tools, "turn_1");
    expect(JSON.stringify(message)).toContain("TEAMSIX_TOOL_CALL");
    expect(JSON.stringify(message)).toContain("shell");
  });

  test("accepts only declared tool names", () => {
    expect(parseToolCall('TEAMSIX_TOOL_CALL:{"name":"shell","arguments":{"command":"dir"}}', tools)).toEqual({
      name: "shell",
      arguments: '{"command":"dir"}',
    });
    expect(parseToolCall('TEAMSIX_TOOL_CALL:{"name":"not_allowed","arguments":{}}', tools)).toBeUndefined();
  });

  test("turns a model tool request into a Responses function_call", () => {
    const call = parseToolCall('TEAMSIX_TOOL_CALL:{"name":"shell","arguments":{"command":"dir"}}', tools)!;
    const converted = synthesizeFunctionCallResponse({
      id: "resp_1",
      object: "response",
      status: "completed",
      model: "chatgpt-web/high",
      output: [],
    }, call, tools);
    const item = (converted.response.output as Array<Record<string, unknown>>)[0]!;
    expect(item.type).toBe("function_call");
    expect(item.name).toBe("shell");
    expect(String(item.call_id)).toStartWith("call_");
  });
});
