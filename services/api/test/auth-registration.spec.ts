import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBetterAuth } from "../src/auth/auth.config.js";
import {
  AuthEmailUnavailableError,
  UnavailableAuthEmailSender,
} from "../src/auth/auth-email.js";
import { createAuthLogger } from "../src/auth/auth-policy.js";
import * as schema from "../src/database/schema/index.js";
import { TestAuthEmailSender } from "./support/auth-email.js";

beforeEach(() => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-only-auth-registration-configuration-12345",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function signup(body: Record<string, unknown>) {
  return new Request("http://localhost:3001/api/v1/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
    },
    body: JSON.stringify(body),
  });
}

const registration = {
  name: "Registration fixture",
  email: "registration@example.invalid",
  password: "test fixture password only",
};

describe("registration policy", () => {
  it("requires verification, uses a one-hour link and disables both automatic sign-ins", async () => {
    const auth = createBetterAuth(
      drizzle.mock({ schema }),
      new TestAuthEmailSender(),
    );
    expect(auth.options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
    });
    expect(auth.options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      sendOnSignIn: false,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
    });
    const context = await auth.$context;
    expect(context.skipOriginCheck).toBe(false);
    expect(context.skipCSRFCheck).toBe(false);
    expect(auth.options).not.toHaveProperty("rateLimit");
    expect(auth.options).not.toHaveProperty("secondaryStorage");
  });

  it.each([
    "emailVerified",
    "id",
    "createdAt",
    "updatedAt",
    "role",
    "churchId",
    "unknown",
  ])(
    "rejects the unsupported signup field %s before database access",
    async (field) => {
      const auth = createBetterAuth(
        drizzle.mock({ schema }),
        new TestAuthEmailSender(),
      );
      const response = await auth.handler(
        signup({ ...registration, [field]: "protected" }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "UNSUPPORTED_SIGNUP_FIELDS",
      });
    },
  );

  it("rejects an untrusted callback destination before database access", async () => {
    const auth = createBetterAuth(
      drizzle.mock({ schema }),
      new TestAuthEmailSender(),
    );
    const response = await auth.handler(
      signup({
        ...registration,
        callbackURL: "https://untrusted.example.invalid/redirect",
      }),
    );
    expect(response.status).toBe(403);
  });

  it.each([11, 129])(
    "rejects a password of length %s before database access",
    async (length) => {
      const auth = createBetterAuth(
        drizzle.mock({ schema }),
        new TestAuthEmailSender(),
      );
      const response = await auth.handler(
        signup({ ...registration, password: "x".repeat(length) }),
      );
      expect(response.status).toBe(400);
    },
  );

  it("fails closed before database writes when no email transport exists in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const auth = createBetterAuth(drizzle.mock({ schema }));
    const response = await auth.handler(signup(registration));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "AUTH_EMAIL_UNAVAILABLE",
      message: "Authentication email delivery is not configured",
    });
  });

  it("does not allow test delivery to be installed in production", () => {
    const sender = new TestAuthEmailSender();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createBetterAuth(drizzle.mock({ schema }), sender)).toThrow(
      "Test email delivery requires NODE_ENV=test",
    );
    expect(() => new TestAuthEmailSender()).toThrow(
      "restricted to test processes",
    );
  });
});

describe("auth email boundary", () => {
  it("captures verification messages only in memory and can reset them", async () => {
    const sender = new TestAuthEmailSender();
    await sender.sendEmailVerification({
      recipient: "fixture@example.invalid",
      url: "http://localhost:3001/test-only-non-authenticating-link",
      token: "not-a-verification-token",
    });
    expect(sender.messages).toHaveLength(1);
    sender.reset();
    expect(sender.messages).toEqual([]);
  });

  it("rejects direct unavailable transport calls rather than discarding messages", async () => {
    const sender = new UnavailableAuthEmailSender();
    expect(() => sender.assertAvailable()).toThrow(AuthEmailUnavailableError);
    await expect(sender.sendEmailVerification()).rejects.toThrow(
      AuthEmailUnavailableError,
    );
  });

  it("does not forward uncontrolled authentication messages or arguments to logs", () => {
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const info = vi
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const debug = vi
      .spyOn(Logger.prototype, "debug")
      .mockImplementation(() => undefined);
    const logger = createAuthLogger();
    for (const level of ["error", "warn", "info", "debug"] as const) {
      logger.log(level, "uncontrolled-sensitive-message", {
        password: "not-a-real-password",
        token: "not-a-real-token",
      });
    }
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Authentication operation failed",
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Authentication request rejected",
    );
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});
