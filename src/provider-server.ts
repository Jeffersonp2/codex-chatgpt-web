#!/usr/bin/env bun
import { loadConfig, type AppConfig } from "./config";
import { isChatGptWebModelSlug } from "./chatgpt-web-models";
import { loadProviderRuntimeSettings, providerEndpoint } from "./provider-config";
import { VERSION } from "./version";
import { BridgeEngine } from "../teamsix-ai-bridge/src/bridge-engine";
import { mapTeamsixModelToUpstream } from "../teamsix-ai-bridge/src/request-normalizer";
import { responseJsonToSse } from "../teamsix-ai-bridge/src/sse";

export interface ProviderServerOptions {
  host?: "127.0.0.1";
  port?: number;
  upstreamBase?: string;
  providerKey?: string;
  log?: boolean;
  unref?: boolean;
}

function envPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return value;
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

function toolsMode(): "bridge" | "passthrough" | "off" {
  const raw = process.env.TEAMSIX_TOOLS_MODE?.trim().toLowerCase() || "bridge";
  if (raw === "bridge" || raw === "passthrough" || raw === "off") return raw;
  throw new Error("TEAMSIX_TOOLS_MODE must be bridge, passthrough, or off");
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({
    error: {
      type: "invalid_request_error",
      code,
      message,
    },
  }, { status });
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TEAMSIX AI Bridge</title>
<style>
:root{color-scheme:dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#0b0d10;color:#edf2f7}body{margin:0;padding:32px}main{max-width:1100px;margin:auto}.hero{display:flex;justify-content:space-between;align-items:center;gap:16px}.badge{padding:7px 11px;border:1px solid #2d3748;border-radius:999px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:24px}.card{background:#12161c;border:1px solid #252b35;border-radius:16px;padding:18px}.ok{color:#68d391}.bad{color:#fc8181}pre{white-space:pre-wrap;word-break:break-word;background:#090b0e;padding:14px;border-radius:10px;overflow:auto}button{background:#f97316;color:white;border:0;border-radius:9px;padding:9px 14px;cursor:pointer}small{color:#94a3b8}</style>
</head>
<body><main>
<div class="hero"><div><h1>TEAMSIX AI Bridge</h1><small>Codex → 9Router → TEAMSIX → ChatGPT Web + Tools + Plugins</small></div><span id="status" class="badge">carregando…</span></div>
<div class="grid">
<div class="card"><h3>Runtime</h3><pre id="runtime"></pre></div>
<div class="card"><h3>Modelos</h3><pre id="models"></pre></div>
<div class="card"><h3>Plugins</h3><button onclick="reloadPlugins()">Recarregar</button><pre id="plugins"></pre></div>
<div class="card"><h3>Sessões</h3><pre id="sessions"></pre></div>
</div>
</main>
<script>
async function get(u,o){const r=await fetch(u,o);return await r.json()}
async function load(){
 const h=await get('/healthz'); const m=await get('/v1/models'); const p=await get('/v1/plugins'); const s=await get('/v1/sessions');
 status.textContent=h.status==='ok'?'ONLINE':'DEGRADED'; status.className='badge '+(h.status==='ok'?'ok':'bad');
 runtime.textContent=JSON.stringify(h,null,2); models.textContent=JSON.stringify(m.data?.map(x=>x.id)||[],null,2); plugins.textContent=JSON.stringify(p,null,2); sessions.textContent=JSON.stringify(s,null,2);
}
async function reloadPlugins(){await get('/v1/plugins/reload',{method:'POST'});await load()}
load();setInterval(load,5000);
</script></body></html>`;
}

export function startProviderServer(
  config: AppConfig,
  options: ProviderServerOptions = {},
): ReturnType<typeof Bun.serve> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? envPort("TEAMSIX_PORT", envPort("CODEX_WEB_PROVIDER_PORT", 11436));
  const upstreamBase = (options.upstreamBase ?? `http://${config.host}:${config.port}`).replace(/\/$/, "");
  const providerKey = options.providerKey
    ?? process.env.TEAMSIX_API_KEY?.trim()
    ?? process.env.CODEX_WEB_PROVIDER_API_KEY?.trim();

  const engine = new BridgeEngine({
    host,
    port,
    apiKey: providerKey || undefined,
    chatGptWebBaseUrl: `${upstreamBase}/v1`,
    requestTimeoutMs: envInt("TEAMSIX_REQUEST_TIMEOUT_MS", 600_000, 1_000, 3_600_000),
    sessionTtlMs: envInt("TEAMSIX_SESSION_TTL_MS", 21_600_000, 60_000, 86_400_000),
    toolsMode: toolsMode(),
    dashboard: true,
  });

  function authorized(req: Request): boolean {
    if (!providerKey) return true;
    return req.headers.get("authorization") === `Bearer ${providerKey}`;
  }

  async function requestedModel(req: Request): Promise<string | undefined> {
    try {
      const body = await req.clone().json() as { model?: unknown };
      return typeof body?.model === "string" ? mapTeamsixModelToUpstream(body.model) : undefined;
    } catch {
      return undefined;
    }
  }

  async function proxy(req: Request, pathname: string): Promise<Response> {
    const target = new URL(pathname, upstreamBase);
    const forwarded = new Request(target, req);
    forwarded.headers.delete("authorization");
    forwarded.headers.delete("host");
    forwarded.headers.delete("content-length");
    try {
      return await fetch(forwarded);
    } catch (error) {
      return jsonError(
        502,
        "provider_upstream_unavailable",
        `TEAMSIX embedded ChatGPT runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function compactProxy(req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try { body = await req.json() as Record<string, unknown>; }
    catch { return jsonError(400, "invalid_json", "Request body must be valid JSON"); }
    if (typeof body.model === "string") body.model = mapTeamsixModelToUpstream(body.model);
    const forwarded = new Request(`${upstreamBase}/v1/responses/compact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return proxy(forwarded, "/v1/responses/compact");
  }

  let boundPort = port;
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(dashboardHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
        const health = await engine.health();
        return Response.json({
          ...health,
          service: "teamsix-ai-bridge",
          version: VERSION,
          provider_url: `http://${host}:${boundPort}/v1`,
          embedded_runtime_url: `${upstreamBase}/v1`,
        }, { status: health.status === "ok" ? 200 : 503 });
      }

      if (!authorized(req)) {
        return jsonError(401, "invalid_api_key", "Invalid TEAMSIX API key");
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return Response.json(await engine.models());
      }
      if (req.method === "GET" && url.pathname === "/v1/plugins") {
        return Response.json({ object: "list", data: engine.plugins.listPlugins(), tools: engine.plugins.listTools() });
      }
      if (req.method === "POST" && url.pathname === "/v1/plugins/reload") {
        engine.plugins.reload();
        return Response.json({ status: "ok", plugins: engine.plugins.listPlugins() });
      }
      if (req.method === "GET" && url.pathname === "/v1/sessions") {
        return Response.json({ object: "list", data: engine.sessions.summary() });
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        return jsonError(
          400,
          "responses_api_required",
          "TEAMSIX preserves the native Codex Responses protocol. Configure 9Router to use the OpenAI Responses API (/v1/responses).",
        );
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        const model = await requestedModel(req);
        if (!model) return jsonError(400, "missing_model", "Request must include a model");
        if (!isChatGptWebModelSlug(model)) {
          return jsonError(
            400,
            "unsupported_provider_model",
            `TEAMSIX accepts only chatgpt-web/* models; received ${JSON.stringify(model)}`,
          );
        }
        let raw: unknown;
        try { raw = await req.json(); }
        catch { return jsonError(400, "invalid_json", "Request body must be valid JSON"); }
        const result = await engine.run(raw);
        if (result.streamRequested) {
          const response = responseJsonToSse(result.payload);
          response.headers.set("x-teamsix-thread-id", result.threadId);
          response.headers.set("x-teamsix-turn-id", result.turnId);
          response.headers.set("x-teamsix-native-codex-identity", String(result.nativeCodexIdentity));
          return response;
        }
        return Response.json(result.payload, {
          status: result.status,
          headers: {
            "x-teamsix-thread-id": result.threadId,
            "x-teamsix-turn-id": result.turnId,
            "x-teamsix-native-codex-identity": String(result.nativeCodexIdentity),
          },
        });
      }

      if (req.method === "GET" && url.pathname === "/v1/responses") {
        return proxy(req, "/v1/responses");
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/compact") {
        const model = await requestedModel(req);
        if (model && !isChatGptWebModelSlug(model)) {
          return jsonError(
            400,
            "unsupported_provider_model",
            `TEAMSIX accepts only chatgpt-web/* models; received ${JSON.stringify(model)}`,
          );
        }
        return compactProxy(req);
      }

      return jsonError(404, "not_found", `TEAMSIX endpoint not found: ${req.method} ${url.pathname}`);
    },
  });
  boundPort = server.port ?? port;

  if (options.unref) server.unref();

  if (options.log !== false) {
    process.stdout.write(
      `TEAMSIX AI Bridge ${VERSION} listening on http://${host}:${boundPort}/v1\n`
        + `embedded ChatGPT Web runtime: ${upstreamBase}/v1\n`
        + `tool mode: ${engine.config.toolsMode}\n`
        + `9Router provider type: OpenAI Responses compatible\n`,
    );
  }

  return server;
}

if (import.meta.main) {
  const config = loadConfig();
  const settings = loadProviderRuntimeSettings();
  if (!settings.enabled) {
    process.stdout.write("TEAMSIX 9Router provider is disabled in provider settings.\n");
  } else {
    const server = startProviderServer(config, {
      host: settings.host,
      port: settings.port,
      log: false,
    });
    process.stdout.write(
      `TEAMSIX AI Bridge ${VERSION} listening on ${providerEndpoint({ ...settings, port: server.port ?? settings.port })}\n`
        + `embedded ChatGPT Web runtime: http://${config.host}:${config.port}/v1\n`
        + `9Router provider type: OpenAI Responses compatible\n`,
    );
    await new Promise<void>(() => {});
  }
}
