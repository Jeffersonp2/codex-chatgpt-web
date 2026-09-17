#!/usr/bin/env bun
import { loadBridgeConfig } from "./config";
import { startBridgeServer } from "./server";

const config = loadBridgeConfig();
const server = startBridgeServer(config);

process.stdout.write([
  "",
  "TEAMSIX AI Bridge",
  `API:       http://${config.host}:${server.port}/v1`,
  `Dashboard: http://${config.host}:${server.port}/`,
  `Upstream:  ${config.chatGptWebBaseUrl}`,
  `Tools:     ${config.toolsMode}`,
  "9Router:   configure as OpenAI Responses API",
  "",
].join("\n"));

const shutdown = () => {
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise<void>(() => {});
