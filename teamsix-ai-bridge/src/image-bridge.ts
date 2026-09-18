import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { getConfigDir } from "../../src/config";

const IMAGE_MARKER = /<teamsix_generated_image>([\s\S]*?)<\/teamsix_generated_image>/g;

interface ImageMarkerPayload {
  path: string;
  mime_type: string;
  sha256: string;
}

export interface ConsumedGeneratedImage {
  cleanedText: string;
  item: Record<string, unknown>;
}

function imageSignatureMatches(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  }
  return false;
}

export function consumeGeneratedImageMarker(text: string): ConsumedGeneratedImage | undefined {
  const matches = [...text.matchAll(IMAGE_MARKER)];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new Error("TEAMSIX browser response contained multiple generated-image markers");

  const raw = matches[0]?.[1]?.trim();
  if (!raw) throw new Error("TEAMSIX generated-image marker is empty");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TEAMSIX generated-image marker is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TEAMSIX generated-image marker payload is invalid");
  }
  const payload = parsed as Partial<ImageMarkerPayload>;
  if (typeof payload.path !== "string"
    || typeof payload.mime_type !== "string"
    || typeof payload.sha256 !== "string"
    || !/^[a-f0-9]{64}$/i.test(payload.sha256)
    || !["image/png", "image/jpeg", "image/webp"].includes(payload.mime_type)) {
    throw new Error("TEAMSIX generated-image marker fields are invalid");
  }

  const root = resolve(join(getConfigDir(), "generated-images"));
  const candidate = resolve(payload.path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("TEAMSIX generated-image marker points outside the private image directory");
  }

  const bytes = readFileSync(candidate);
  if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024) {
    throw new Error("TEAMSIX generated image has an invalid size");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== payload.sha256.toLowerCase()) {
    throw new Error("TEAMSIX generated image checksum mismatch");
  }
  if (!imageSignatureMatches(bytes, payload.mime_type)) {
    throw new Error("TEAMSIX generated image bytes do not match the declared MIME type");
  }

  const cleanedText = text.replace(IMAGE_MARKER, "").trim();
  return {
    cleanedText,
    item: {
      id: `ig_${randomUUID().replaceAll("-", "")}`,
      type: "image_generation_call",
      status: "completed",
      result: bytes.toString("base64"),
    },
  };
}

export function synthesizeImageGenerationResponse(
  upstream: Record<string, unknown>,
  consumed: ConsumedGeneratedImage,
): Record<string, unknown> {
  const output: Record<string, unknown>[] = [];
  if (consumed.cleanedText) {
    output.push({
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: consumed.cleanedText, annotations: [] }],
    });
  }
  output.push(consumed.item);
  return {
    ...upstream,
    status: "completed",
    output,
    error: null,
    last_error: null,
  };
}
