export interface BridgeConfig {
  host: string;
  port: number;
  apiKey?: string;
  chatGptWebBaseUrl: string;
  requestTimeoutMs: number;
  sessionTtlMs: number;
  toolsMode: "bridge" | "passthrough" | "off";
  dashboard: boolean;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true/false`);
}

function envToolsMode(): BridgeConfig["toolsMode"] {
  const raw = process.env.TEAMSIX_TOOLS_MODE?.trim().toLowerCase() || "bridge";
  if (raw === "bridge" || raw === "passthrough" || raw === "off") return raw;
  throw new Error("TEAMSIX_TOOLS_MODE must be bridge, passthrough, or off");
}

export function loadBridgeConfig(): BridgeConfig {
  return {
    host: process.env.TEAMSIX_HOST?.trim() || "127.0.0.1",
    port: envInt("TEAMSIX_PORT", 11436, 1, 65535),
    apiKey: process.env.TEAMSIX_API_KEY?.trim() || undefined,
    chatGptWebBaseUrl: (process.env.TEAMSIX_CHATGPT_WEB_URL?.trim() || "http://127.0.0.1:17841/v1").replace(/\/$/, ""),
    requestTimeoutMs: envInt("TEAMSIX_REQUEST_TIMEOUT_MS", 600_000, 1_000, 3_600_000),
    sessionTtlMs: envInt("TEAMSIX_SESSION_TTL_MS", 21_600_000, 60_000, 86_400_000),
    toolsMode: envToolsMode(),
    dashboard: envBool("TEAMSIX_DASHBOARD", true),
  };
}
