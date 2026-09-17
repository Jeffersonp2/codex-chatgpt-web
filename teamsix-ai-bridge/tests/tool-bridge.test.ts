import { describe, expect, test } from "bun:test";
import { makeToolContractMessage, parseToolCall } from "../src/tool-bridge";

const localTool = {
  type: "function",
  name: "write_file",
  description: "Write a file in the current Codex workspace",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
};

describe("tool relay helpers", () => {
  test("advertises Codex tools to the browser model without executing them locally", () => {
    const message = makeToolContractMessage([localTool], "turn_native_456");
    expect(message).toBeDefined();
    expect(JSON.stringify(message)).toContain("TEAMSIX_TOOL_CALL");
    expect(JSON.stringify(message)).toContain("write_file");
    expect(message?.internal_chat_message_metadata_passthrough).toEqual({ turn_id: "turn_native_456" });
  });

  test("parses a browser-selected Codex tool for Responses function_call relay", () => {
    const selected = parseToolCall(
      'TEAMSIX_TOOL_CALL:{"name":"write_file","arguments":{"path":"hello.txt","content":"ok"}}',
      [localTool],
    );
    expect(selected?.name).toBe("write_file");
    expect(JSON.parse(selected?.arguments ?? "{}")).toEqual({ path: "hello.txt", content: "ok" });
  });

  test("rejects tools that Codex did not expose to the turn", () => {
    expect(parseToolCall(
      'TEAMSIX_TOOL_CALL:{"name":"unknown_tool","arguments":{}}',
      [localTool],
    )).toBeUndefined();
  });
});
