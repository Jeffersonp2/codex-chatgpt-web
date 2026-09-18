import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertNormalChatPage, CHATGPT_NORMAL_CHAT_URL } from "../src/chatgpt-session";

test("TEAMSIX production turns use normal ChatGPT only", async () => {
  expect(CHATGPT_NORMAL_CHAT_URL).toBe("https://chatgpt.com/");

  await expect(assertNormalChatPage({ url: () => "https://chatgpt.com/" } as never)).resolves.toBeUndefined();
  await expect(assertNormalChatPage({ url: () => "https://chatgpt.com/c/example" } as never)).resolves.toBeUndefined();
  await expect(assertNormalChatPage({ url: () => "https://chatgpt.com/?temporary-chat=true" } as never))
    .rejects.toThrow("normal chat surface");
});

test("TEAMSIX browser execution is hard-wired to normal chat", () => {
  const worker = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8");
  const adapter = readFileSync("src/adapters/chatgpt-web/index.ts", "utf8");
  const helper = readFileSync("src/adapters/chatgpt-web/browser-helper-main.ts", "utf8");
  const prompt = readFileSync("src/adapters/chatgpt-web/prompt.ts", "utf8");

  expect(worker).toContain('"normal_chat_preparation"');
  expect(worker).toContain('this.prepareChatSurface(\n            page,\n            "normal"');
  expect(worker).not.toContain('const chatMode = turn.chatMode ?? "temporary"');
  expect(adapter.match(/chatMode: "normal"/g)?.length).toBeGreaterThanOrEqual(2);
  expect(helper).toContain('chatMode: "normal"');
  expect(prompt).toContain("if (parsed._teamsixChatMode) return undefined;");
});
