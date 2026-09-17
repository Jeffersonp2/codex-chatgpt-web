const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const DEFAULT_PROVIDER_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  url: "http://127.0.0.1",
  port: 11435,
});

function normalizeProviderUrl(value) {
  const raw = typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_PROVIDER_SETTINGS.url;
  let parsed;
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
  return parsed.hostname === "localhost" ? "http://localhost" : "http://127.0.0.1";
}

function normalizeProviderPort(value) {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("9Router provider port must be an integer from 1 to 65535");
  }
  return port;
}

function validateProviderSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    enabled: input.enabled === undefined ? DEFAULT_PROVIDER_SETTINGS.enabled : input.enabled === true,
    url: normalizeProviderUrl(input.url),
    port: normalizeProviderPort(input.port ?? DEFAULT_PROVIDER_SETTINGS.port),
  };
}

function providerSettingsPath(coreHome) {
  return path.join(coreHome, "provider.json");
}

function readProviderSettings(coreHome) {
  const pathname = providerSettingsPath(coreHome);
  if (!fs.existsSync(pathname)) return { ...DEFAULT_PROVIDER_SETTINGS };
  try {
    return validateProviderSettings(JSON.parse(fs.readFileSync(pathname, "utf8")));
  } catch (error) {
    throw new Error(
      `Invalid 9Router provider settings at ${pathname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeProviderSettings(coreHome, value) {
  const settings = validateProviderSettings(value);
  fs.mkdirSync(coreHome, { recursive: true, mode: 0o700 });
  writePrivateFileAtomic(providerSettingsPath(coreHome), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

function resolveUserPath(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function providerCoreHome() {
  const configured = process.env.CODEX_CHATGPT_WEB_HOME?.trim();
  return configured ? resolveUserPath(configured) : path.join(os.homedir(), ".codex-chatgpt-web");
}

function registerProviderSettingsIpc() {
  let electron;
  try {
    electron = require("electron");
  } catch {
    return false;
  }
  const ipcMain = electron && typeof electron === "object" ? electron.ipcMain : null;
  if (!ipcMain || typeof ipcMain.handle !== "function") return false;

  const registrationKey = Symbol.for("codex-web-gpt.provider-settings-ipc");
  if (globalThis[registrationKey]) return true;

  ipcMain.handle("launcher:provider-settings-read", () => readProviderSettings(providerCoreHome()));
  ipcMain.handle("launcher:provider-settings-write", (_event, value) => writeProviderSettings(providerCoreHome(), value));
  globalThis[registrationKey] = true;
  return true;
}

registerProviderSettingsIpc();

module.exports = {
  DEFAULT_PROVIDER_SETTINGS,
  providerSettingsPath,
  readProviderSettings,
  registerProviderSettingsIpc,
  validateProviderSettings,
  writeProviderSettings,
};
