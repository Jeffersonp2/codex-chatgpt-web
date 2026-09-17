const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const DEFAULT_PROVIDER_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  url: "http://127.0.0.1",
  port: 11436,
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
      `Invalid TEAMSIX 9Router provider settings at ${pathname}: ${error instanceof Error ? error.message : String(error)}`,
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

function routerManagedProviderEnabled(coreHome = providerCoreHome()) {
  try {
    return readProviderSettings(coreHome).enabled === true;
  } catch {
    return false;
  }
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

  const registrationKey = Symbol.for("teamsix-ai-bridge.provider-settings-ipc");
  if (globalThis[registrationKey]) return true;

  ipcMain.handle("launcher:provider-settings-read", () => readProviderSettings(providerCoreHome()));
  ipcMain.handle("launcher:provider-settings-write", (_event, value) => writeProviderSettings(providerCoreHome(), value));
  globalThis[registrationKey] = true;
  return true;
}

function installRouterManagedRuntimeHooks() {
  const patchKey = Symbol.for("teamsix-ai-bridge.router-managed-runtime-hooks");
  if (globalThis[patchKey]) return true;

  let RuntimeHost;
  let RuntimeSupervisor;
  try {
    ({ RuntimeHost } = require("./runtime.cjs"));
    ({ RuntimeSupervisor } = require("./runtime-supervisor.cjs"));
  } catch {
    return false;
  }
  if (!RuntimeHost?.prototype || !RuntimeSupervisor?.prototype) return false;

  const originalUpgradeManagedRuntime = RuntimeHost.prototype.upgradeManagedRuntime;
  const originalConnectBridgeRoute = RuntimeHost.prototype.connectBridgeRoute;
  const originalRestoreBridgeRoute = RuntimeHost.prototype.restoreBridgeRoute;
  const originalRestoreBridgeRouteWithinOperation = RuntimeHost.prototype.restoreBridgeRouteWithinOperation;
  const originalDoctor = RuntimeHost.prototype.doctor;
  const originalReadConfig = RuntimeSupervisor.prototype.readConfig;

  const routerManagedFor = (host) => host?.launcherProfile === "production"
    && routerManagedProviderEnabled(host?.coreHome || providerCoreHome());

  RuntimeSupervisor.prototype.readConfig = function (...args) {
    const config = originalReadConfig.apply(this, args);
    if (!config || !routerManagedFor(this)) return config;

    // TEAMSIX owns tool/plugin translation itself. The embedded ChatGPT browser runtime must
    // therefore stay connector-free even if an older local setup was configured as Full MCP.
    // This is an in-memory runtime view only; the user's stored tunnel/MCP configuration is not
    // deleted and can still be used by the original project if TEAMSIX mode is later disabled.
    const patched = {
      ...config,
      mode: "browser-only",
      browserInteractionMode: "automatic",
    };

    const launcherVersion = this.app?.getVersion?.();
    if (typeof launcherVersion === "string" && launcherVersion && patched.releaseVersion !== launcherVersion) {
      patched.releaseVersion = launcherVersion;
      if (!this.__routerManagedVersionCompatibilityLogged) {
        this.__routerManagedVersionCompatibilityLogged = true;
        this.logger?.info?.("runtime.router_managed_release_compat", {
          configuredVersion: config.releaseVersion,
          launcherVersion,
          reason: "TEAMSIX keeps 9Router as the Codex route owner and uses an embedded browser-only runtime",
        });
      }
    }

    if (!this.__teamsixBrowserOnlyLogged && config.mode !== "browser-only") {
      this.__teamsixBrowserOnlyLogged = true;
      this.logger?.info?.("runtime.teamsix_browser_only", {
        configuredMode: config.mode,
        runtimeMode: "browser-only",
        reason: "TEAMSIX Tool Bridge relays Codex tools without requiring Codex Native2",
      });
    }
    return patched;
  };

  RuntimeHost.prototype.upgradeManagedRuntime = async function (...args) {
    if (routerManagedFor(this)) {
      this.logger?.info?.("runtime.router_managed_upgrade_skipped", {
        reason: "TEAMSIX/9Router mode preserves the existing runtime config and Codex route",
      });
      return { updated: false, routerManaged: true };
    }
    return originalUpgradeManagedRuntime.apply(this, args);
  };

  RuntimeHost.prototype.connectBridgeRoute = async function (...args) {
    if (routerManagedFor(this)) {
      this.logger?.info?.("bridge.router_managed_connect_skipped", {
        reason: "Codex remains routed through 9Router",
      });
      return {
        installed: true,
        active: false,
        changed: false,
        routerManaged: true,
      };
    }
    return originalConnectBridgeRoute.apply(this, args);
  };

  RuntimeHost.prototype.restoreBridgeRoute = async function (...args) {
    if (routerManagedFor(this)) {
      this.logger?.info?.("bridge.router_managed_restore_skipped", {
        reason: "TEAMSIX does not own the Codex route while 9Router provider mode is enabled",
      });
      return {
        installed: true,
        active: false,
        changed: false,
        restored: false,
        routerManaged: true,
      };
    }
    return originalRestoreBridgeRoute.apply(this, args);
  };

  RuntimeHost.prototype.restoreBridgeRouteWithinOperation = async function (...args) {
    if (routerManagedFor(this)) {
      return {
        installed: true,
        active: false,
        changed: false,
        restored: false,
        routerManaged: true,
      };
    }
    return originalRestoreBridgeRouteWithinOperation.apply(this, args);
  };

  RuntimeHost.prototype.doctor = async function (...args) {
    const report = await originalDoctor.apply(this, args);
    if (!routerManagedFor(this) || !report || !Array.isArray(report.checks)) return report;

    let changed = false;
    const checks = report.checks.map((check) => {
      if (!check || check.id !== "codex" || check.status !== "error") return check;
      changed = true;
      return {
        ...check,
        status: "ok",
        message: "Codex routing is managed by 9Router",
        detail: "TEAMSIX intentionally leaves the Codex route under 9Router and exposes its own local Responses provider.",
      };
    });

    if (!changed) return report;
    this.logger?.info?.("doctor.router_managed_codex_route_accepted", {
      reason: "9Router owns the Codex route",
    });
    return {
      ...report,
      ok: checks.every((check) => check?.status !== "error"),
      checks,
    };
  };

  globalThis[patchKey] = true;
  return true;
}

registerProviderSettingsIpc();
installRouterManagedRuntimeHooks();

module.exports = {
  DEFAULT_PROVIDER_SETTINGS,
  providerSettingsPath,
  readProviderSettings,
  registerProviderSettingsIpc,
  routerManagedProviderEnabled,
  validateProviderSettings,
  writeProviderSettings,
};
