import { describe, expect, test } from "bun:test";
import { normalizeResponsesRequest } from "../src/request-normalizer";
import { makeToolContractMessage, parseToolCall, synthesizeFunctionCallResponse } from "../src/tool-bridge";

const tools = [{
  type: "function",
  name: "shell",
  description: "Run a command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
}];

describe("TEAMSIX request normalization", () => {
  test("creates turn metadata for generic Responses clients", () => {
    const normalized = normalizeResponsesRequest({
      model: "teamsix/chatgpt-web/high",
      input: "hello",
      stream: false,
    });
    expect(normalized.nativeCodexIdentity).toBe(false);
    expect(normalized.identity.threadId.startsWith("thread_")).toBe(true);
    expect(normalized.identity.turnId.startsWith("turn_")).toBe(true);
    const client = normalized.body.client_metadata as Record<string, string>;
    const meta = JSON.parse(client["x-codex-turn-metadata"]!);
    expect(meta.thread_id).toBe(normalized.identity.threadId);
    expect(meta.turn_id).toBe(normalized.identity.turnId);
    const input = normalized.body.input as Array<Record<string, any>>;
    expect(input[0]?.internal_chat_message_metadata_passthrough?.turn_id).toBe(normalized.identity.turnId);
  });

  test("preserves native Codex identity", () => {
    const normalized = normalizeResponsesRequest({
      model: "teamsix/chatgpt-web/high",
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_native", turn_id: "turn_native" }),
      },
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
    });
    expect(normalized.nativeCodexIdentity).toBe(true);
    expect(normalized.identity).toEqual({ threadId: "thread_native", turnId: "turn_native" });
  });
});

describe("TEAMSIX tool bridge", () => {
  test("builds a local-tool contract", () => {
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
    }, call);
    const item = (converted.response.output as Array<Record<string, unknown>>)[0]!;
    expect(item.type).toBe("function_call");
    expect(item.name).toBe("shell");
    expect(String(item.call_id)).toStartWith("call_");
  });
});
