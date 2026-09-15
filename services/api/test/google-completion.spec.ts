import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  googleCompletionInput,
  GoogleCompletionLimiter,
} from "../src/auth/google-completion-policy.js";
import { preparationTwoFactor } from "../src/auth/auth-two-factor.js";
import {
  GOOGLE_AUTHENTICATION_ENABLED,
  googleCredentials,
} from "../src/auth/google-pre-auth-policy.js";

const challenge = randomBytes(32).toString("hex");
describe("Google factor completion policy", () => {
  it.each(["totp", "recovery"] as const)(
    "accepts exactly challenge and canonical %s proof",
    (method) => {
      const code = method === "totp" ? "012345" : "abcde-12345";
      expect(googleCompletionInput({ challenge, code }, method)).toEqual({
        challenge,
        code,
      });
    },
  );
  it.each([
    "userId",
    "sessionId",
    "provider",
    "trustDevice",
    "disableSession",
    "elevatedAt",
    "stepUpAt",
    "role",
    "permission",
    "timestamp",
  ])("rejects injected %s", (field) => {
    expect(() =>
      googleCompletionInput(
        { challenge, code: "012345", [field]: true },
        "totp",
      ),
    ).toThrow();
  });
  it.each([
    null,
    {},
    [],
    { code: "012345" },
    { challenge },
    { challenge: "bad", code: "012345" },
    { challenge, code: 123456 },
    { challenge, code: "12345" },
    { challenge, code: "1234567" },
    { challenge, code: " 012345" },
  ])("rejects malformed request %#", (body) => {
    expect(() => googleCompletionInput(body, "totp")).toThrow();
  });
  it.each(["bad", "abcde12345", "abcde-1234", "abcde-123456", "abcde-1234!"])(
    "rejects malformed recovery syntax %#",
    (code) => {
      expect(() =>
        googleCompletionInput({ challenge, code }, "recovery"),
      ).toThrow();
    },
  );
  it("limits both proof methods to five attempts per challenge in a sliding minute", () => {
    const limiter = new GoogleCompletionLimiter();
    for (let i = 0; i < 5; i++) limiter.consume(challenge, 1000);
    expect(() => limiter.consume(challenge, 60999)).toThrow();
    expect(() => limiter.consume(challenge, 61000)).not.toThrow();
  });
  it("independent challenges have independent bounded budgets", () => {
    const limiter = new GoogleCompletionLimiter();
    for (let i = 0; i < 5; i++) limiter.consume(challenge, 1000);
    expect(() =>
      limiter.consume(randomBytes(32).toString("hex"), 1000),
    ).not.toThrow();
  });
  it("capacity fails closed without evicting active attempts, then expires safely", () => {
    const limiter = new GoogleCompletionLimiter();
    for (let i = 0; i < 10000; i++)
      limiter.consume(i.toString(16).padStart(64, "0"), 0);
    expect(() => limiter.consume(challenge, 59999)).toThrow();
    expect(() => limiter.consume(challenge, 60000)).not.toThrow();
  });
  it("mounts only the two completion endpoints and retains source throttling", () => {
    const plugin = preparationTwoFactor();
    expect(plugin.endpoints.completeGoogleTotp.path).toBe(
      "/social/google/verify-totp",
    );
    expect(plugin.endpoints.completeGoogleRecovery.path).toBe(
      "/social/google/verify-recovery-code",
    );
    expect(plugin.endpoints.completeGoogleTotp.options.method).toBe("POST");
    const rule = plugin.rateLimit.find((rule) =>
      rule.pathMatcher("/social/google/verify-totp"),
    );
    expect(rule?.max).toBe(5);
    expect(rule?.window).toBe(60);
    expect("sendTwoFactorOTP" in plugin.endpoints).toBe(false);
  });
  it("does not activate Google, signup, implicit linking or assurance", () => {
    expect(GOOGLE_AUTHENTICATION_ENABLED).toBe(false);
    expect(
      googleCredentials({
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
      } as NodeJS.ProcessEnv)?.disableSignUp,
    ).toBe(true);
    expect(
      Object.getOwnPropertyNames(GoogleCompletionLimiter.prototype).sort(),
    ).toEqual(["constructor", "consume", "deny"]);
  });
  it("accepts the HttpOnly pre-auth cookie with code-only body", () => {
    expect(
      googleCompletionInput({ code: "012345" }, "totp", challenge),
    ).toEqual({ challenge, code: "012345" });
  });
  it("rejects contradictory body/cookie challenge identities", () => {
    expect(() =>
      googleCompletionInput(
        { challenge, code: "012345" },
        "totp",
        randomBytes(32).toString("hex"),
      ),
    ).toThrow();
  });
});
