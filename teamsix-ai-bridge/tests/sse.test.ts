import { describe, expect, test } from "bun:test";
import { responseJsonToSse } from "../src/sse";

describe("responseJsonToSse", () => {
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
