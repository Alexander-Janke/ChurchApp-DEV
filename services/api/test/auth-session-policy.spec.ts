import "reflect-metadata";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBetterAuth } from "../src/auth/auth.config.js";
import {
  AuthSessionPolicy,
  WEB_SESSION_ABSOLUTE_MS,
} from "../src/auth/auth-session-policy.js";
import * as schema from "../src/database/schema/index.js";

beforeEach(() => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "session-policy-test-only-not-a-runtime-secret-12345",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
});
afterEach(() => vi.unstubAllEnvs());

describe("normal web session policy", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const boundary = createdAt.getTime() + WEB_SESSION_ABSOLUTE_MS;
  it.each([
    [-1, false],
    [0, true],
    [1, true],
  ] as const)(
    "absolute boundary offset %i ms has expired=%s",
    (offset, expired) => {
      const policy = new AuthSessionPolicy(() => boundary + offset);
      expect(
        policy.isExpired({
          createdAt,
          expiresAt: new Date(boundary + 86_400_000),
        }),
      ).toBe(expired);
    },
  );
  it("rejects an inactivity deadline exactly at the clock", () => {
    const now = createdAt.getTime() + 1_000;
    expect(
      new AuthSessionPolicy(() => now).isExpired({
        createdAt,
        expiresAt: new Date(now),
      }),
    ).toBe(true);
  });
  it.each([new Date(NaN), new Date(boundary + 1)])(
    "fails closed for invalid or future creation timestamps",
    (value) => {
      expect(
        new AuthSessionPolicy(() => boundary).isExpired({
          createdAt: value,
          expiresAt: new Date(boundary + 1000),
        }),
      ).toBe(true);
    },
  );
  it("requires no credentials and produces only a boolean, not diagnostic session data", () => {
    const policy = new AuthSessionPolicy(() => boundary);
    expect(policy.isExpired({ createdAt, expiresAt: new Date(NaN) })).toBe(
      true,
    );
  });
  it("sets seven-day rolling expiry and one-day refresh, without alternate session authority", () => {
    const auth = createBetterAuth(drizzle.mock({ schema }));
    expect(auth.options.session).toEqual({
      expiresIn: 604800,
      updateAge: 86400,
      cookieCache: { enabled: false },
    });
    expect(auth.options).not.toHaveProperty("secondaryStorage");
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toEqual([
      "application-session-revocation-audit",
      "application-password-audit",
      "google-pre-auth",
      "application-email-change",
      "two-factor",
    ]);
    expect(auth.options).not.toHaveProperty("rateLimit");
  });
  it.each([
    ["test", "http://localhost:3001", false],
    ["test", "https://example.invalid", true],
    ["production", "http://example.invalid", true],
  ])(
    "keeps secure cookie attributes for %s at %s",
    async (environment, url, secure) => {
      vi.stubEnv("NODE_ENV", environment!);
      vi.stubEnv("BETTER_AUTH_URL", url!);
      const ctx = await createBetterAuth(drizzle.mock({ schema })).$context;
      const cookie = ctx.authCookies.sessionToken;
      expect(cookie.attributes).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
        maxAge: 604800,
      });
      expect(cookie.attributes.domain).toBeUndefined();
      expect(cookie.name).toBe(
        `${secure ? "__Secure-" : ""}better-auth.session_token`,
      );
    },
  );
  it.each(["role", "churchId", "userId", "emailVerified", "unknown"])(
    "rejects protected sign-in field %s without accessing the database",
    async (field) => {
      const auth = createBetterAuth(drizzle.mock({ schema }));
      const response = await auth.handler(
        new Request("http://localhost:3001/api/v1/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3001",
          },
          body: JSON.stringify({
            email: "fixture@example.invalid",
            password: "test-only fixture password",
            [field]: "untrusted",
          }),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: "UNSUPPORTED_SIGNIN_FIELDS",
        message: "Sign-in contains unsupported fields",
      });
    },
  );
});
