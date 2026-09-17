import { loadBridgeConfig } from "./config";
import { startBridgeServer } from "./server";

const config = loadBridgeConfig();
const server = startBridgeServer(config);

process.stdout.write(
  `TEAMSIX bridge-core development server listening on http://${config.host}:${server.port}/v1\n`
    + `This standalone entrypoint is for development only. The packaged TEAMSIX AI Bridge owns its embedded ChatGPT runtime.\n`,
);

await new Promise<void>(() => {});
