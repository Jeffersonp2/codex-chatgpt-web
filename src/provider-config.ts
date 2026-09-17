import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./config";

export interface ProviderRuntimeSettings {
  version: 1;
  enabled: boolean;
  url: string;
  host: "127.0.0.1";
  port: number;
}

export const DEFAULT_PROVIDER_RUNTIME_SETTINGS: ProviderRuntimeSettings = Object.freeze({
  version: 1,
  enabled: true,
  url: "http://127.0.0.1",
  host: "127.0.0.1",
  port: 11435,
});

export function providerSettingsPath(): string {
  return join(getConfigDir(), "provider.json");
}

function normalizeProviderUrl(value: unknown): { url: string; host: "127.0.0.1" } {
  const raw = typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_PROVIDER_RUNTIME_SETTINGS.url;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("9Router provider URL must be http://127.0.0.1 or http://localhost");
  }
  if (parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.port
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password) {
    throw new Error("9Router provider URL must be http://127.0.0.1 or http://localhost without a port or path");
  }
  return {
    url: parsed.hostname === "localhost" ? "http://localhost" : "http://127.0.0.1",
    // Keep the listener IPv4-loopback-only even when the friendly URL uses localhost.
    host: "127.0.0.1",
  };
}

function normalizeProviderPort(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("9Router provider port must be an integer from 1 to 65535");
  }
  return port;
}

export function normalizeProviderRuntimeSettings(value: unknown): ProviderRuntimeSettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const endpoint = normalizeProviderUrl(input.url);
  return {
    version: 1,
    enabled: input.enabled === undefined ? DEFAULT_PROVIDER_RUNTIME_SETTINGS.enabled : input.enabled === true,
    url: endpoint.url,
    host: endpoint.host,
    port: normalizeProviderPort(input.port ?? DEFAULT_PROVIDER_RUNTIME_SETTINGS.port),
  };
}

export function loadProviderRuntimeSettings(): ProviderRuntimeSettings {
  const path = providerSettingsPath();
  if (!existsSync(path)) return { ...DEFAULT_PROVIDER_RUNTIME_SETTINGS };
  try {
    return normalizeProviderRuntimeSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(
      `Invalid 9Router provider settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function providerEndpoint(settings: ProviderRuntimeSettings): string {
  return `${settings.url}:${settings.port}/v1`;
}
