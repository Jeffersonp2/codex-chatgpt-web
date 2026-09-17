import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolDefinition } from "./session-store";

export interface HttpPluginTool {
  name: string;
  description?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  inputSchema?: Record<string, unknown>;
}

export interface HttpPlugin {
  id: string;
  name: string;
  enabled?: boolean;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  tools: HttpPluginTool[];
}

interface PluginFile {
  plugins?: HttpPlugin[];
}

export interface PluginToolDescriptor extends ToolDefinition {
  pluginId: string;
  pluginToolName: string;
}

function safePluginToolName(pluginId: string, toolName: string): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `plugin__${clean(pluginId)}__${clean(toolName)}`;
}

function substitutePath(path: string, input: Record<string, unknown>): string {
  return path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    if (!(key in input)) throw new Error(`Missing plugin path parameter: ${key}`);
    const value = input[key];
    delete input[key];
    return encodeURIComponent(String(value));
  });
}

export class PluginHub {
  private plugins: HttpPlugin[] = [];

  constructor(private readonly configPath: string = process.env.TEAMSIX_PLUGINS_FILE?.trim() || resolve(process.cwd(), "plugins.json")) {
    this.reload();
  }

  reload(): void {
    if (!existsSync(this.configPath)) {
      this.plugins = [];
      return;
    }
    const parsed = JSON.parse(readFileSync(this.configPath, "utf8")) as PluginFile;
    this.plugins = Array.isArray(parsed.plugins)
      ? parsed.plugins.filter(plugin => plugin && plugin.enabled !== false && plugin.id && plugin.baseUrl && Array.isArray(plugin.tools))
      : [];
  }

  listPlugins(): Array<{ id: string; name: string; baseUrl: string; toolCount: number; authenticated: boolean }> {
    return this.plugins.map(plugin => ({
      id: plugin.id,
      name: plugin.name,
      baseUrl: plugin.baseUrl,
      toolCount: plugin.tools.length,
      authenticated: !plugin.apiKeyEnv || Boolean(process.env[plugin.apiKeyEnv]),
    }));
  }

  listTools(): PluginToolDescriptor[] {
    return this.plugins.flatMap(plugin => plugin.tools.map(tool => ({
      type: "function",
      name: safePluginToolName(plugin.id, tool.name),
      description: `[Plugin ${plugin.name}] ${tool.description ?? tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
      pluginId: plugin.id,
      pluginToolName: tool.name,
    })));
  }

  isPluginTool(name: string): boolean {
    return this.listTools().some(tool => tool.name === name);
  }

  async invoke(name: string, rawArgs: unknown): Promise<unknown> {
    const descriptor = this.listTools().find(tool => tool.name === name);
    if (!descriptor) throw new Error(`Unknown TEAMSIX plugin tool: ${name}`);
    const plugin = this.plugins.find(item => item.id === descriptor.pluginId);
    const tool = plugin?.tools.find(item => item.name === descriptor.pluginToolName);
    if (!plugin || !tool) throw new Error(`Plugin tool configuration disappeared: ${name}`);

    const input = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? { ...(rawArgs as Record<string, unknown>) }
      : {};
    const method = tool.method ?? "POST";
    const path = substitutePath(tool.path, input);
    const url = new URL(path, plugin.baseUrl.endsWith("/") ? plugin.baseUrl : `${plugin.baseUrl}/`);
    const headers = new Headers({ accept: "application/json" });
    if (plugin.apiKeyEnv) {
      const token = process.env[plugin.apiKeyEnv]?.trim();
      if (!token) throw new Error(`Plugin ${plugin.id} requires environment variable ${plugin.apiKeyEnv}`);
      headers.set(plugin.apiKeyHeader || "authorization", `${plugin.apiKeyPrefix ?? "Bearer "}${token}`);
    }

    let body: string | undefined;
    if (method === "GET" || method === "DELETE") {
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
    } else {
      headers.set("content-type", "application/json");
      body = JSON.stringify(input);
    }

    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(120_000) });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(`Plugin ${plugin.id}/${tool.name} returned HTTP ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
    }
    return payload;
  }
}
