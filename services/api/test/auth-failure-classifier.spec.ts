import { describe, expect, it } from "vitest";
import {
  AUTH_FAILURE_CLASSIFIER_CAPACITY,
  AUTH_FAILURE_THRESHOLD,
  AUTH_FAILURE_WINDOW_MS,
  AuthenticationFailureClassifier,
  credentialFailureTarget,
  subjectFailureTarget,
} from "../src/auth/auth-failure-classifier.js";

function observation(
  flow: "password" | "totp" | "recovery" | "google" = "password",
  target = "user:user-a",
) {
  return {
    flow,
    method:
      flow === "password"
        ? ("password" as const)
        : flow === "recovery"
          ? ("recovery" as const)
          : ("totp" as const),
    target,
    subjectUserId: target.startsWith("user:") ? "user-a" : null,
  };
}

describe("authentication failure classification policy", () => {
  it("emits only on the fifth qualifying failure and suppresses duplicates", async () => {
    let now = 1_000;
    const events: unknown[] = [];
    const classifier = new AuthenticationFailureClassifier(
      async (event) => void events.push(event),
      () => now,
    );
    for (let i = 0; i < 4; i++) await classifier.observe(observation());
    expect(events).toHaveLength(0);
    await classifier.observe(observation());
    await classifier.observe(observation());
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      eventType: "authentication_failure",
      actorUserId: null,
      subjectUserId: "user-a",
      sessionId: null,
      metadata: { method: "password", category: "repeated" },
    });
    now += AUTH_FAILURE_WINDOW_MS;
    for (let i = 0; i < AUTH_FAILURE_THRESHOLD; i++)
      await classifier.observe(observation());
    expect(events).toHaveLength(2);
  });

  it("uses age < ten minutes and rejects the equality boundary", async () => {
    let now = 0;
    const events: unknown[] = [];
    const classifier = new AuthenticationFailureClassifier(
      async (event) => void events.push(event),
      () => now,
    );
    for (let i = 0; i < 4; i++) await classifier.observe(observation());
    now = AUTH_FAILURE_WINDOW_MS;
    for (let i = 0; i < 4; i++) await classifier.observe(observation());
    expect(events).toHaveLength(0);
    await classifier.observe(observation());
    expect(events).toHaveLength(1);
  });

  it("resets transient history after successful authentication", async () => {
    const events: unknown[] = [];
    const classifier = new AuthenticationFailureClassifier(async (event) => {
      events.push(event);
    });
    for (let i = 0; i < 4; i++) await classifier.observe(observation());
    classifier.reset("password", ["user:user-a"]);
    await classifier.observe(observation());
    expect(events).toHaveLength(0);
  });

  it("keeps authentication flows and users isolated", async () => {
    const events: unknown[] = [];
    const classifier = new AuthenticationFailureClassifier(async (event) => {
      events.push(event);
    });
    for (let i = 0; i < 3; i++) {
      await classifier.observe(observation("password", "user:user-a"));
      await classifier.observe(observation("totp", "user:user-a"));
      await classifier.observe(observation("password", "user:user-b"));
    }
    await classifier.observe(observation("password", "user:user-a"));
    await classifier.observe(observation("totp", "user:user-a"));
    await classifier.observe(observation("password", "user:user-b"));
    expect(events).toHaveLength(0);
    await classifier.observe(observation("password", "user:user-a"));
    expect(events).toHaveLength(1);
  });

  it("emits one event for concurrent threshold crossing", async () => {
    const events: unknown[] = [];
    const classifier = new AuthenticationFailureClassifier(async (event) => {
      events.push(event);
    });
    await Promise.all(
      Array.from({ length: AUTH_FAILURE_THRESHOLD }, () =>
        classifier.observe(observation()),
      ),
    );
    expect(events).toHaveLength(1);
  });

  it("fails closed at bounded capacity and prunes only expired keys", async () => {
    let now = 0;
    const classifier = new AuthenticationFailureClassifier(
      async () => undefined,
      () => now,
    );
    for (let i = 0; i < AUTH_FAILURE_CLASSIFIER_CAPACITY; i++)
      await classifier.observe(observation("password", `user:${i}`));
    expect(classifier.size).toBe(AUTH_FAILURE_CLASSIFIER_CAPACITY);
    await classifier.observe(observation("password", "user:overflow"));
    expect(classifier.size).toBe(AUTH_FAILURE_CLASSIFIER_CAPACITY);
    now = AUTH_FAILURE_WINDOW_MS;
    await classifier.observe(observation("password", "user:overflow"));
    expect(classifier.size).toBe(1);
  }, 20_000);

  it("normalizes credential targets without exposing them as event metadata", () => {
    expect(credentialFailureTarget("  USER@Example.Invalid ")).toBe(
      "login:user@example.invalid",
    );
    expect(credentialFailureTarget("malformed")).toBeNull();
    expect(subjectFailureTarget("user-a")).toBe("user:user-a");
  });

  it("does not turn event persistence failure into an authentication result", async () => {
    const classifier = new AuthenticationFailureClassifier(async () => {
      throw new Error("storage failure");
    });
    await expect(
      Promise.all(
        Array.from({ length: AUTH_FAILURE_THRESHOLD }, () =>
          classifier.observe(observation()),
        ),
      ),
    ).resolves.toBeDefined();
  });
});
