import { describe, expect, test } from "bun:test";
import { BridgeEngine } from "../src/bridge-engine";

const config = {
  host: "127.0.0.1",
  port: 11436,
  chatGptWebBaseUrl: "http://127.0.0.1:1/v1",
  requestTimeoutMs: 1_000,
  sessionTtlMs: 60_000,
  toolsMode: "bridge" as const,
  chatMode: "auto" as const,
  dashboard: true,
};

describe("BridgeEngine", () => {
  test("keeps a local ChatGPT Web model catalog available while embedded runtime is starting", async () => {
    const engine = new BridgeEngine(config);
    const catalog = await engine.models() as {
      object: string;
      data: Array<{ id: string }>;
    };
    expect(catalog.object).toBe("list");
    const ids = catalog.data.map(item => item.id);
    expect(ids).toContain("chatgpt-web/high");
  });
});
