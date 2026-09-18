import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertNormalChatPage, CHATGPT_NORMAL_CHAT_URL, CHATGPT_TEMPORARY_CHAT_URL } from "../src/chatgpt-session";

test("TEAMSIX has distinct normal and temporary ChatGPT surfaces", async () => {
  expect(CHATGPT_NORMAL_CHAT_URL).toBe("https://chatgpt.com/");
  expect(CHATGPT_TEMPORARY_CHAT_URL).toContain("temporary-chat=true");

  await expect(assertNormalChatPage({ url: () => "https://chatgpt.com/" } as never)).resolves.toBeUndefined();
  await expect(assertNormalChatPage({ url: () => "https://chatgpt.com/c/example" } as never)).resolves.toBeUndefined();
  await expect(assertNormalChatPage({ url: () => "https://chatgpt.com/?temporary-chat=true" } as never))
    .rejects.toThrow("normal chat surface");
});

test("browser helper protocol carries the resolved TEAMSIX chat mode", () => {
  const worker = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8");
  const adapter = readFileSync("src/adapters/chatgpt-web/index.ts", "utf8");
  const client = readFileSync("src/adapters/chatgpt-web/launcher-helper-client.ts", "utf8");
  const helper = readFileSync("src/adapters/chatgpt-web/browser-helper-main.ts", "utf8");

  expect(worker).toContain('export type ChatGptChatSurface = "normal" | "temporary"');
  expect(worker).toContain("prepareChatSurface(");
  expect(worker).toContain('"normal-chat-navigation-complete"');
  expect(adapter).toContain('chatMode: parsed._teamsixChatMode ?? "temporary"');
  expect(client).toContain("turn.chatMode");
  expect(helper).toContain('chatMode?: "normal" | "temporary"');
});
