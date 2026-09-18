import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeGeneratedImageMarker, synthesizeImageGenerationResponse } from "../src/image-bridge";

const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
const roots: string[] = [];

afterEach(() => {
  if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
  else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("converts a private generated-image marker into a native Responses image item", () => {
  const root = mkdtempSync(join(tmpdir(), "teamsix-image-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const dir = join(root, "generated-images", "thread_test");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "ig_test.png");
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlS8i8AAAAASUVORK5CYII=",
    "base64",
  );
  writeFileSync(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const text = `Image ready.\n<teamsix_generated_image>${JSON.stringify({
    path,
    mime_type: "image/png",
    sha256,
  })}</teamsix_generated_image>`;

  const consumed = consumeGeneratedImageMarker(text);
  expect(consumed?.cleanedText).toBe("Image ready.");
  expect(consumed?.item.type).toBe("image_generation_call");
  expect(consumed?.item.status).toBe("completed");
  expect(consumed?.item.result).toBe(bytes.toString("base64"));

  const response = synthesizeImageGenerationResponse({ id: "resp_test", output: [] }, consumed!);
  expect((response.output as Array<Record<string, unknown>>).at(-1)?.type).toBe("image_generation_call");
});

test("refuses generated-image markers outside the private TEAMSIX directory", () => {
  const root = mkdtempSync(join(tmpdir(), "teamsix-image-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  const outside = join(root, "outside.png");
  const bytes = Buffer.from("89504e470d0a1a0a", "hex");
  writeFileSync(outside, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  expect(() => consumeGeneratedImageMarker(
    `<teamsix_generated_image>${JSON.stringify({
      path: outside,
      mime_type: "image/png",
      sha256,
    })}</teamsix_generated_image>`,
  )).toThrow("outside the private image directory");
});
