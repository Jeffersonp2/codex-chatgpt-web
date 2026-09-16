#!/usr/bin/env bun
import { stdout } from "node:process";
import { loadConfig } from "./config";
import { startProviderServer } from "./provider-server";
import { startServer } from "./server";
import { VERSION } from "./version";

async function runCombinedServe(args: string[]): Promise<void> {
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);

  const config = loadConfig();
  const core = startServer(config);

  try {
    const provider = startProviderServer(config, { log: false, unref: true });
    stdout.write(
      `codex-chatgpt-web ${VERSION} listening on http://${config.host}:${core.port}/v1 (${config.mode})\n`
        + `9Router provider listening on http://127.0.0.1:${provider.port}/v1\n`,
    );
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
  // Preserve every existing CLI command without duplicating the original command parser.
  await import("./cli");
}
