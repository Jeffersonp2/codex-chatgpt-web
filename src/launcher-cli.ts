#!/usr/bin/env bun
import { stdout } from "node:process";
import { loadConfig } from "./config";
import { loadProviderRuntimeSettings, providerEndpoint } from "./provider-config";
import { startProviderServer } from "./provider-server";
import { startServer } from "./server";
import { VERSION } from "./version";

async function runCombinedServe(args: string[]): Promise<void> {
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

  const config = loadConfig();
  const providerSettings = loadProviderRuntimeSettings();

  if (providerSettings.enabled) {
    // In TEAMSIX mode, ChatGPT Web is only the browser/model transport. Codex tools and plugins
    // are relayed by the TEAMSIX provider itself, so the embedded transport must never require the
    // Codex Native2 connector. This changes only the live runtime object, not config.json on disk.
    config.mode = "browser-only";
    config.browserInteractionMode = "automatic";
  }

  const core = startServer(config);

  try {
    if (providerSettings.enabled) {
      const provider = startProviderServer(config, {
        host: providerSettings.host,
        port: providerSettings.port,
        log: false,
        unref: true,
      });
      stdout.write(
        `TEAMSIX AI Bridge ${VERSION} ready on ${providerEndpoint({ ...providerSettings, port: provider.port ?? providerSettings.port })}\n`
          + `embedded ChatGPT Web transport: http://${config.host}:${core.port}/v1 (browser-only)\n`
          + "Codex route owner: 9Router\n",
      );
    } else {
      stdout.write(
        `codex-chatgpt-web ${VERSION} listening on http://${config.host}:${core.port}/v1 (${config.mode})\n`
          + "TEAMSIX 9Router provider disabled by settings\n",
      );
    }
  } catch (error) {
    await core.stop(true);
    throw error;
  }

  await new Promise<void>(() => {});
}

const args = process.argv.slice(2);
const command = args.shift() ?? "help";

if (command === "serve" || command === "9router") {
  await runCombinedServe(args);
} else {
  await import("./cli");
}
