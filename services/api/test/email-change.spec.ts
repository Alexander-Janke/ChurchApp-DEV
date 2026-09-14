import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { betterAuth } from "better-auth";
import { createBetterAuth } from "../src/auth/auth.config.js";
import { EmailChangeService } from "../src/auth/email-change.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import {
  activeEmailChangeStates,
  emailChangeExpired,
  hashEmailChangeToken,
  newEmailChangeToken,
  normalizeEmail,
  requireEmailChangeToken,
  singleField,
} from "../src/auth/email-change-policy.js";
import * as schema from "../src/database/schema/index.js";
import { TestAuthEmailSender } from "./support/auth-email.js";

beforeEach(() => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "email-change-test-only-not-a-runtime-secret-12345",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("application email change policy", () => {
  it("keeps native email change and cookie cache disabled", () => {
    const auth = createBetterAuth(drizzle.mock({ schema }));
    expect(auth.options.user?.changeEmail).toMatchObject({
      enabled: false,
      updateEmailWithoutVerification: false,
    });
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
  });
  it.each([
    [-1, false],
    [0, true],
    [1, true],
  ])("uses exact absolute expiry boundary at offset %i", (offset, expired) => {
    expect(
      emailChangeExpired(new Date(10000), new Date(10000 + Number(offset))),
    ).toBe(expired);
  });
  it.each(["Test@Example.COM", "first.last+tag@example.com"])(
    "normalizes only casing for %s",
    (email) => {
      expect(normalizeEmail(email)).toBe(email.toLowerCase());
    },
  );
  it.each([
    " test@example.com",
    "test@example.com ",
    "a..b@example.com",
    "bad",
  ])("rejects rather than trims malformed email %s", (email) => {
    expect(() => normalizeEmail(email)).toThrow(
      "Email change cannot be completed",
    );
  });
  it("generates 256-bit opaque tokens and matches hashes without retaining the raw credential", () => {
    const first = newEmailChangeToken();
    const second = newEmailChangeToken();
    expect(first.token.length).toBe(43);
    expect(first.hash.length).toBe(64);
    expect(first.hash === hashEmailChangeToken(first.token)).toBe(true);
    expect(first.hash === second.hash).toBe(false);
    expect(first.hash.includes(first.token)).toBe(false);
    expect(requireEmailChangeToken(first.token) === first.token).toBe(true);
  });
  it("defines only incomplete states as active for latest-request-wins", () => {
    expect([...activeEmailChangeStates]).toEqual([
      "pending_current_email",
      "pending_new_email",
    ]);
  });
  it("rejects extra fields without echoing their values", () => {
    expect(() =>
      singleField({ token: "test-secret", userId: "private" }, "token"),
    ).toThrow("Email change cannot be completed");
  });
  it("keeps message types separate and never logs failed completion payloads", async () => {
    const sender = new TestAuthEmailSender();
    await sender.deliverEmailChangeApproval({
      recipient: "old@example.invalid",
      newEmail: "new@example.invalid",
      url: "http://localhost/#test-only",
      token: "test-only",
    });
    await sender.deliverEmailChangeVerification({
      recipient: "new@example.invalid",
      url: "http://localhost/#test-only",
      token: "test-only",
    });
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(sender, "sendEmailChangeCompleted").mockRejectedValueOnce(
      new Error("private mail secret"),
    );
    sender.dispatchEmailChangeCompleted({
      recipient: "old@example.invalid",
      newEmail: "new@example.invalid",
    });
    await sender.onModuleDestroy();
    expect(sender.emailChangeApprovals.length).toBe(1);
    expect(sender.emailChangeVerifications.length).toBe(1);
    expect(sender.messages.length).toBe(0);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Authentication email delivery failed",
    );
  });
  it("bounds required delivery while tracking its eventual settlement", async () => {
    vi.useFakeTimers();
    const sender = new TestAuthEmailSender();
    let release!: () => void;
    vi.spyOn(sender, "sendEmailChangeVerification").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const delivery = sender.deliverEmailChangeVerification({
      recipient: "new@example.invalid",
      url: "http://localhost/#test-only",
      token: "test-only",
    });
    const result = expect(delivery).rejects.toThrow(
      "Authentication email delivery failed",
    );
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    let drained = false;
    const drain = sender.onModuleDestroy().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await drain;
  });
  it.each([
    ["request", 3],
    ["approve-current", 10],
    ["verify-new", 10],
  ] as const)(
    "protects %s with the actual native router limiter",
    async (path, max) => {
      const sender = new TestAuthEmailSender();
      const service = new EmailChangeService(
        {} as DatabaseService,
        sender,
        "http://localhost:3001",
      );
      vi.spyOn(service, "approve").mockResolvedValue();
      vi.spyOn(service, "verify").mockResolvedValue();
      const configured = createBetterAuth(
        drizzle.mock({ schema }),
        sender,
        undefined,
        service,
      );
      const auth = betterAuth({
        ...configured.options,
        rateLimit: { enabled: true, storage: "memory" },
      });
      const token = newEmailChangeToken().token;
      const call = () =>
        auth.handler(
          new Request(
            `http://localhost:3001/api/v1/auth/email-change/${path}`,
            {
              method: "POST",
              headers: {
                origin: "http://localhost:3001",
                "content-type": "application/json",
                "x-forwarded-for": "192.0.2.19",
              },
              body: JSON.stringify(
                path === "request"
                  ? { newEmail: "new@example.invalid" }
                  : { token },
              ),
            },
          ),
        );
      for (let i = 0; i < max; i++)
        expect((await call()).status).toBe(path === "request" ? 401 : 200);
      expect((await call()).status).toBe(429);
    },
  );
});
