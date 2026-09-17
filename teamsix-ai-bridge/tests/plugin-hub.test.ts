import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginHub } from "../src/plugin-hub";

let scratch: string | undefined;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe("PluginHub", () => {
  test("loads only enabled declarative HTTP plugins and namespaces their tools", () => {
    scratch = mkdtempSync(join(tmpdir(), "teamsix-plugin-test-"));
    const config = join(scratch, "plugins.json");
    writeFileSync(config, JSON.stringify({
      plugins: [
        {
          id: "demo",
          name: "Demo",
          baseUrl: "https://example.com/api/",
          enabled: true,
          tools: [{ name: "lookup", path: "lookup", inputSchema: { type: "object" } }],
        },
        {
          id: "disabled",
          name: "Disabled",
          baseUrl: "https://example.com/",
          enabled: false,
          tools: [{ name: "skip", path: "skip" }],
        },
      ],
    }), "utf8");

    const hub = new PluginHub(config);
    expect(hub.listPlugins()).toHaveLength(1);
    expect(hub.listTools()).toHaveLength(1);
    expect(hub.listTools()[0]?.name).toBe("plugin__demo__lookup");
  });
});
