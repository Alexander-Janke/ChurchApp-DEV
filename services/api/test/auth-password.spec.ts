import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBetterAuth } from "../src/auth/auth.config.js";
import {
  AuthEmailUnavailableError,
  UnavailableAuthEmailSender,
} from "../src/auth/auth-email.js";
import { enforcePasswordRequest } from "../src/auth/auth-password-policy.js";
import type { GenericEndpointContext } from "better-auth";
import * as schema from "../src/database/schema/index.js";
import { TestAuthEmailSender } from "./support/auth-email.js";

beforeEach(() => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "password-policy-test-only-not-a-runtime-secret-12345",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function post(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost:3001/api/v1/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
    },
    body: JSON.stringify(body),
  });
}

describe("password policy foundation", () => {
  it("shares the 12–128 policy and explicitly configures one-hour reset plus all-session revocation", () => {
    const auth = createBetterAuth(drizzle.mock({ schema }));
    expect(auth.options.emailAndPassword).toMatchObject({
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      autoSignIn: false,
    });
    expect(auth.options.emailAndPassword).not.toHaveProperty("password");
    expect(auth.options).not.toHaveProperty("rateLimit");
  });
  it.each([true, false, undefined])(
    "does not allow native session replacement with revokeOtherSessions=%s",
    (value) => {
      // Minimal hook context; native password verification remains integration-tested.
      const ctx = {
        path: "/change-password",
        body: {
          currentPassword: "old fixture password",
          newPassword: "new fixture password",
          ...(value === undefined ? {} : { revokeOtherSessions: value }),
        },
      } as GenericEndpointContext;
      expect(
        enforcePasswordRequest(ctx)?.context.body.revokeOtherSessions,
      ).toBe(false);
    },
  );
  it("rejects normalized current-password reuse without reading a hash", async () => {
    const auth = createBetterAuth(
      drizzle.mock({ schema }),
      new TestAuthEmailSender(),
    );
    const response = await auth.handler(
      post("/change-password", {
        currentPassword: "fixture caf\u00e9 password",
        newPassword: "fixture cafe\u0301 password",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PASSWORD_MUST_DIFFER");
  });
  it.each(["existing@example.invalid", "unknown@example.invalid"])(
    "fails closed uniformly without production delivery for %s",
    async (email) => {
      vi.stubEnv("NODE_ENV", "production");
      const auth = createBetterAuth(drizzle.mock({ schema }));
      const response = await auth.handler(
        post("/request-password-reset", {
          email,
          redirectTo: "http://localhost:3001/reset",
        }),
      );
      expect(response.status).toBe(503);
      expect((await response.json()).message).toBe(
        "Authentication email delivery is not configured",
      );
    },
  );
  it("rejects an untrusted reset redirect before database access", async () => {
    const auth = createBetterAuth(
      drizzle.mock({ schema }),
      new TestAuthEmailSender(),
    );
    expect(
      (
        await auth.handler(
          post("/request-password-reset", {
            email: "fixture@example.invalid",
            redirectTo: "https://untrusted.example.invalid/reset",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it.each([11, 129])(
    "rejects reset passwords of length %i before consuming a token",
    async (length) => {
      const auth = createBetterAuth(
        drizzle.mock({ schema }),
        new TestAuthEmailSender(),
      );
      expect(
        (
          await auth.handler(
            post("/reset-password", {
              token: "invalid-test-token",
              newPassword: "x".repeat(length),
            }),
          )
        ).status,
      ).toBe(400);
    },
  );
  it("captures verification, reset and change notices distinctly, only in test memory", async () => {
    const sender = new TestAuthEmailSender();
    sender.dispatchPasswordReset({
      recipient: "fixture@example.invalid",
      url: "http://localhost/test-only",
      token: "not-a-valid-token",
    });
    sender.dispatchPasswordChanged({
      recipient: "fixture@example.invalid",
      reason: "reset",
    });
    await sender.onModuleDestroy();
    expect(sender.passwordResets.length).toBe(1);
    expect(sender.passwordChanges.length).toBe(1);
    expect(sender.messages.length).toBe(0);
    sender.reset();
    expect(sender.passwordResets.length + sender.passwordChanges.length).toBe(
      0,
    );
  });
  it("tracks asynchronous delivery and drains it on shutdown without exposing provider diagnostics", async () => {
    const sender = new TestAuthEmailSender();
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    let reject!: (error: Error) => void;
    vi.spyOn(sender, "sendPasswordReset").mockImplementation(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    sender.dispatchPasswordReset({
      recipient: "fixture@example.invalid",
      url: "http://localhost/test-only",
      token: "test-token-must-not-be-logged",
    });
    await Promise.resolve();
    let drained = false;
    const shutdown = sender.onModuleDestroy().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    reject(new Error("private provider URL and test-token-must-not-be-logged"));
    await shutdown;
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Authentication email delivery failed",
    );
  });
  it("never discards unavailable reset or notification delivery silently", async () => {
    const sender = new UnavailableAuthEmailSender();
    await expect(sender.sendPasswordReset()).rejects.toThrow(
      AuthEmailUnavailableError,
    );
    await expect(sender.sendPasswordChanged()).rejects.toThrow(
      AuthEmailUnavailableError,
    );
  });
});
