import { randomUUID } from "node:crypto";
import type { TeamsixChatMode } from "./config";

export type TeamsixToolWireType = "function" | "custom" | "tool_search";

export interface ToolDefinition {
  type?: string;
  name?: string;
  description?: string;
  parameters?: unknown;
  /** TEAMSIX-facing flattened name can differ from the native Codex wire name for namespaces. */
  teamsixWireName?: string;
  /** Native Responses call shape required when the tool is returned to Codex. */
  teamsixWireType?: TeamsixToolWireType;
  /** Explicit MCP/Responses namespace expected by Codex for namespaced function calls. */
  teamsixNamespace?: string;
  [key: string]: unknown;
}

export interface PendingToolCall {
  callId: string;
  name: string;
  arguments: string;
  wireType?: TeamsixToolWireType;
  namespace?: string;
  createdAt: number;
}

export interface BridgeSession {
  threadId: string;
  lastTurnId: string;
  createdAt: number;
  updatedAt: number;
  tools: ToolDefinition[];
  pendingCalls: Map<string, PendingToolCall>;
  chatMode?: Exclude<TeamsixChatMode, "auto">;
}

export interface TurnIdentity {
  threadId: string;
  turnId: string;
}

const safeId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll("-", "")}`;

export function newThreadId(): string {
  return safeId("thread");
}

export function newTurnId(): string {
  return safeId("turn");
}

export function newMessageId(): string {
  return safeId("msg");
}

export function newCallId(): string {
  return safeId("call");
}

export class SessionStore {
  private readonly sessions = new Map<string, BridgeSession>();

  constructor(private readonly ttlMs: number) {}

  resolve(identity?: Partial<TurnIdentity>): BridgeSession {
    this.cleanup();
    const threadId = identity?.threadId?.trim() || newThreadId();
    const turnId = identity?.turnId?.trim() || newTurnId();
    const now = Date.now();
    const existing = this.sessions.get(threadId);
    if (existing) {
      existing.lastTurnId = turnId;
      existing.updatedAt = now;
      return existing;
    }
    const created: BridgeSession = {
      threadId,
      lastTurnId: turnId,
      createdAt: now,
      updatedAt: now,
      tools: [],
      pendingCalls: new Map(),
    };
    this.sessions.set(threadId, created);
    return created;
  }

  setTools(threadId: string, tools: ToolDefinition[]): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.tools = tools;
    session.updatedAt = Date.now();
  }

  setChatMode(threadId: string, chatMode: Exclude<TeamsixChatMode, "auto">): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.chatMode = chatMode;
    session.updatedAt = Date.now();
  }

  addPendingCall(threadId: string, call: PendingToolCall): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.pendingCalls.set(call.callId, call);
    session.updatedAt = Date.now();
  }

  consumePendingCall(threadId: string, callId: string): PendingToolCall | undefined {
    const session = this.sessions.get(threadId);
    const call = session?.pendingCalls.get(callId);
    if (call && session) {
      session.pendingCalls.delete(callId);
      session.updatedAt = Date.now();
    }
    return call;
  }

  summary(): Array<{ threadId: string; lastTurnId: string; toolCount: number; pendingCalls: number; chatMode?: "normal" | "temporary"; updatedAt: number }> {
    this.cleanup();
    return [...this.sessions.values()].map(session => ({
      threadId: session.threadId,
      lastTurnId: session.lastTurnId,
      toolCount: session.tools.length,
      pendingCalls: session.pendingCalls.size,
      ...(session.chatMode ? { chatMode: session.chatMode } : {}),
      updatedAt: session.updatedAt,
    }));
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, session] of this.sessions) {
      if (session.updatedAt < cutoff) this.sessions.delete(key);
    }
  }
}
