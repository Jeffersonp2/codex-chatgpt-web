import type { BridgeConfig } from "./config";
import { BridgeEngine } from "./bridge-engine";
import { mapTeamsixModelToUpstream } from "./request-normalizer";
import { responseJsonToSse } from "./sse";

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { type: "invalid_request_error", code, message } }, { status });
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
<div class="hero"><div><h1>TEAMSIX AI Bridge</h1><small>9Router → TEAMSIX → ChatGPT Web + Tools + Plugins</small></div><span id="status" class="badge">carregando…</span></div>
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

export function startBridgeServer(config: BridgeConfig): ReturnType<typeof Bun.serve> {
  const engine = new BridgeEngine(config);

  const authorized = (req: Request): boolean => {
    if (!config.apiKey) return true;
    return req.headers.get("authorization") === `Bearer ${config.apiKey}`;
  };

  const compactProxy = async (req: Request): Promise<Response> => {
    let body: Record<string, unknown>;
    try { body = await req.json() as Record<string, unknown>; }
    catch { return jsonError(400, "invalid_json", "Request body must be valid JSON"); }
    if (typeof body.model === "string") body.model = mapTeamsixModelToUpstream(body.model);
    try {
      const response = await fetch(`${config.chatGptWebBaseUrl}/responses/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      return jsonError(502, "compact_upstream_unavailable", error instanceof Error ? error.message : String(error));
    }
  };

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/" && config.dashboard) {
        return new Response(dashboardHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
        const health = await engine.health();
        return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
      }

      if (!authorized(req)) return jsonError(401, "invalid_api_key", "Invalid TEAMSIX API key");

      if (req.method === "GET" && url.pathname === "/v1/models") return Response.json(await engine.models());
      if (req.method === "GET" && url.pathname === "/v1/plugins") return Response.json({ object: "list", data: engine.plugins.listPlugins(), tools: engine.plugins.listTools() });
      if (req.method === "POST" && url.pathname === "/v1/plugins/reload") {
        engine.plugins.reload();
        return Response.json({ status: "ok", plugins: engine.plugins.listPlugins() });
      }
      if (req.method === "GET" && url.pathname === "/v1/sessions") return Response.json({ object: "list", data: engine.sessions.summary() });

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        return jsonError(400, "responses_api_required", "TEAMSIX preserves the Codex Responses protocol. Configure 9Router as Responses API.");
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/compact") return compactProxy(req);

      if (req.method === "POST" && url.pathname === "/v1/responses") {
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

      return jsonError(404, "not_found", `TEAMSIX endpoint not found: ${req.method} ${url.pathname}`);
    },
  });

  return server;
}
