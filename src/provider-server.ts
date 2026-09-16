#!/usr/bin/env bun
import { loadConfig, type AppConfig } from "./config";
import { availableChatGptWebModelRoutes, isChatGptWebModelSlug } from "./chatgpt-web-models";
import { loadProviderRuntimeSettings, providerEndpoint } from "./provider-config";
import { VERSION } from "./version";

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

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({
    error: {
      type: "invalid_request_error",
      code,
      message,
    },
  }, { status });
}

export function startProviderServer(
  config: AppConfig,
  options: ProviderServerOptions = {},
): ReturnType<typeof Bun.serve> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? envPort("CODEX_WEB_PROVIDER_PORT", 11435);
  const upstreamBase = options.upstreamBase ?? `http://${config.host}:${config.port}`;
  const providerKey = options.providerKey ?? process.env.CODEX_WEB_PROVIDER_API_KEY?.trim();

  function authorized(req: Request): boolean {
    if (!providerKey) return true;
    return req.headers.get("authorization") === `Bearer ${providerKey}`;
  }

  function providerModels(): Response {
    const created = Math.floor(Date.now() / 1000);
    const data = availableChatGptWebModelRoutes(config).map(route => ({
      id: route.slug,
      object: "model",
      created,
      owned_by: "codex-chatgpt-web",
      display_name: route.displayName,
      description: route.description,
    }));
    return Response.json({ object: "list", data });
  }

  async function requestedModel(req: Request): Promise<string | undefined> {
    try {
      const body = await req.clone().json() as { model?: unknown };
      return typeof body?.model === "string" ? body.model : undefined;
    } catch {
      return undefined;
    }
  }

  async function proxy(req: Request, pathname: string): Promise<Response> {
    const target = new URL(pathname, upstreamBase);
    const forwarded = new Request(target, req);

    // 9Router credentials are local provider credentials. They must never become
    // upstream OpenAI credentials if the request is accidentally misrouted.
    forwarded.headers.delete("authorization");
    forwarded.headers.delete("host");
    forwarded.headers.delete("content-length");

    try {
      return await fetch(forwarded);
    } catch (error) {
      return jsonError(
        502,
        "provider_upstream_unavailable",
        `codex-chatgpt-web daemon is unavailable at ${upstreamBase}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function health(): Promise<Response> {
    let upstream: Record<string, unknown> | null = null;
    let upstreamOk = false;
    try {
      const response = await fetch(`${upstreamBase}/healthz`, { signal: AbortSignal.timeout(2_000) });
      upstreamOk = response.ok;
      if (response.headers.get("content-type")?.includes("application/json")) {
        upstream = await response.json() as Record<string, unknown>;
      }
    } catch {
      // Provider health remains readable even when the browser-backed daemon is offline.
    }

    return Response.json({
      status: upstreamOk ? "ok" : "degraded",
      service: "codex-chatgpt-web-provider",
      version: VERSION,
      provider_url: `http://${host}:${port}/v1`,
      upstream_url: `${upstreamBase}/v1`,
      upstream_ok: upstreamOk,
      upstream,
      models: availableChatGptWebModelRoutes(config).map(route => route.slug),
    }, { status: upstreamOk ? 200 : 503 });
  }

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
        return health();
      }

      if (!authorized(req)) {
        return jsonError(401, "invalid_api_key", "Invalid provider API key");
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return providerModels();
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        return jsonError(
          400,
          "responses_api_required",
          "This provider preserves the native Codex Responses protocol. Configure 9Router to use the OpenAI Responses API (/v1/responses), not Chat Completions.",
        );
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        const model = await requestedModel(req);
        if (!model) return jsonError(400, "missing_model", "Request must include a model");
        if (!isChatGptWebModelSlug(model)) {
          return jsonError(
            400,
            "unsupported_provider_model",
            `Provider mode accepts only chatgpt-web/* models; received ${JSON.stringify(model)}`,
          );
        }
        return proxy(req, "/v1/responses");
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
            `Provider mode accepts only chatgpt-web/* models; received ${JSON.stringify(model)}`,
          );
        }
        return proxy(req, "/v1/responses/compact");
      }

      return jsonError(404, "not_found", `Provider endpoint not found: ${req.method} ${url.pathname}`);
    },
  });

  if (options.unref) server.unref();

  if (options.log !== false) {
    process.stdout.write(
      `codex-chatgpt-web provider ${VERSION} listening on http://${host}:${server.port}/v1\n`
        + `upstream codex-chatgpt-web daemon: ${upstreamBase}/v1\n`
        + `9Router provider type: OpenAI Responses compatible\n`,
    );
  }

  return server;
}

if (import.meta.main) {
  const config = loadConfig();
  const settings = loadProviderRuntimeSettings();
  if (!settings.enabled) {
    process.stdout.write("9Router provider is disabled in provider settings.\n");
  } else {
    const server = startProviderServer(config, {
      host: settings.host,
      port: settings.port,
      log: false,
    });
    process.stdout.write(
      `codex-chatgpt-web provider ${VERSION} listening on ${providerEndpoint({ ...settings, port: server.port })}\n`
        + `upstream codex-chatgpt-web daemon: http://${config.host}:${config.port}/v1\n`
        + `9Router provider type: OpenAI Responses compatible\n`,
    );
    await new Promise<void>(() => {});
  }
}
