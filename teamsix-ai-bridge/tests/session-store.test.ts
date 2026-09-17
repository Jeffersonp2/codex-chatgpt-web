import { describe, expect, test } from "bun:test";
import { SessionStore } from "../src/session-store";

describe("SessionStore", () => {
  test("reuses a thread session and tracks the latest turn", () => {
    const sessions = new SessionStore(60_000);
    const first = sessions.resolve({ threadId: "thread_test", turnId: "turn_1" });
    expect(first.threadId).toBe("thread_test");
    expect(first.lastTurnId).toBe("turn_1");

    const second = sessions.resolve({ threadId: "thread_test", turnId: "turn_2" });
    expect(second).toBe(first);
    expect(second.lastTurnId).toBe("turn_2");
    expect(sessions.summary()).toHaveLength(1);
  });
});
