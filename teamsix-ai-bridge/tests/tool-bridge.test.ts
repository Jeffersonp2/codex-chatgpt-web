import { describe, expect, test } from "bun:test";
import { ToolBridge } from "../src/tool-bridge";

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

describe("ToolBridge", () => {
  test("advertises Codex tools to the browser model without executing them locally", () => {
    const bridge = new ToolBridge([localTool], []);
    const contract = bridge.browserContract();
    expect(contract).toContain("TEAMSIX_TOOL_CALL");
    expect(contract).toContain("write_file");
  });

  test("parses a browser-selected Codex tool into a relay request", () => {
    const bridge = new ToolBridge([localTool], []);
    const selected = bridge.parseModelAnswer(
      'TEAMSIX_TOOL_CALL:{"name":"write_file","arguments":{"path":"hello.txt","content":"ok"}}',
    );
    expect(selected?.name).toBe("write_file");
    expect(selected?.arguments).toEqual({ path: "hello.txt", content: "ok" });
    expect(bridge.isLocalTool("write_file")).toBe(true);
  });
});
