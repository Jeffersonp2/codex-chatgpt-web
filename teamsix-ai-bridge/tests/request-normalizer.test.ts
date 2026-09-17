import { describe, expect, test } from "bun:test";
import { mapTeamsixModelToUpstream, normalizeResponsesRequest } from "../src/request-normalizer";

describe("request normalizer", () => {
  test("synthesizes turn identity for a generic Responses request", () => {
    const normalized = normalizeResponsesRequest({
      model: "chatgpt-web/high",
      input: "hello",
    });
    expect(normalized.nativeCodexIdentity).toBe(false);
    expect(normalized.identity.threadId).toBeTruthy();
    expect(normalized.identity.turnId).toBeTruthy();
    const metadata = JSON.parse((normalized.body.client_metadata as Record<string, string>)["x-codex-turn-metadata"]!);
    expect(metadata.thread_id).toBe(normalized.identity.threadId);
    expect(metadata.turn_id).toBe(normalized.identity.turnId);
  });

  test("preserves native Codex thread and turn identity", () => {
    const metadata = {
      thread_id: "thread_native_123",
      turn_id: "turn_native_456",
      sandbox: "workspace-write",
      workspaces: { "C:\\repo": {} },
    };
    const normalized = normalizeResponsesRequest({
      model: "chatgpt-web/high",
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify(metadata),
      },
      input: [{
        type: "message",
        role: "user",
        id: "msg_native",
        content: [{ type: "input_text", text: "use my tools" }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn_native_456" },
      }],
      tools: [{ type: "function", name: "shell", parameters: { type: "object" } }],
    });

    expect(normalized.nativeCodexIdentity).toBe(true);
    expect(normalized.identity).toEqual({ threadId: "thread_native_123", turnId: "turn_native_456" });
    expect(normalized.tools).toHaveLength(1);
    const outputMetadata = JSON.parse((normalized.body.client_metadata as Record<string, string>)["x-codex-turn-metadata"]!);
    expect(outputMetadata).toEqual(metadata);
  });

  test("accepts native Codex metadata already supplied as an object", () => {
    const normalized = normalizeResponsesRequest({
      model: "chatgpt-web/medium",
      client_metadata: {
        "x-codex-turn-metadata": {
          thread_id: "thread_object",
          turn_id: "turn_object",
          sandbox: "none",
          workspaces: {},
        },
      },
      input: "hello",
    });
    expect(normalized.nativeCodexIdentity).toBe(true);
    expect(normalized.identity).toEqual({ threadId: "thread_object", turnId: "turn_object" });
  });

  test("maps 9Router provider prefixes without changing the ChatGPT Web model", () => {
    expect(mapTeamsixModelToUpstream("teamsix/chatgpt-web/high")).toBe("chatgpt-web/high");
    expect(mapTeamsixModelToUpstream("cgw/chatgpt-web/medium")).toBe("chatgpt-web/medium");
    expect(mapTeamsixModelToUpstream("chatgpt-web/light")).toBe("chatgpt-web/light");
  });
});
