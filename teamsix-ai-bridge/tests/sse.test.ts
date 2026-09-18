import { describe, expect, test } from "bun:test";
import { responseJsonToSse, responsePromiseToSse } from "../src/sse";

describe("responseJsonToSse", () => {
  test("opens a deferred Responses SSE stream immediately with a keepalive", async () => {
    let resolveResponse!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>(resolve => {
      resolveResponse = resolve;
    });
    const response = responsePromiseToSse(pending, 60_000);
    expect(response.headers.get("x-teamsix-streaming-mode")).toBe("buffered-with-keepalive");

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("teamsix-keepalive");

    resolveResponse({
      id: "resp_deferred",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "chatgpt-web/high",
      output: [{
        id: "msg_deferred",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "done", annotations: [] }],
      }],
    });

    let rest = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(rest).toContain("response.completed");
    expect(rest).toContain("resp_deferred");
  });

  test("returns a Responses SSE stream for a completed response", async () => {
    const response = responseJsonToSse({
      id: "resp_test",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "chatgpt-web/high",
      output: [{
        id: "msg_test",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "ok", annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("response.completed");
    expect(text).toContain("resp_test");
  });
});
