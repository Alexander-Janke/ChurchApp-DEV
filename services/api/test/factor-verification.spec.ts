import { describe, it, expect } from "vitest";
import {
  factorCode,
  factorBody,
} from "../src/auth/factor-verification-policy.js";
import { preparationTwoFactor } from "../src/auth/auth-two-factor.js";

describe("strict factor proof boundary", () => {
  it.each(["totp", "recovery"] as const)(
    "accepts only canonical %s code",
    (method) => {
      const code = method === "totp" ? "123456" : "abcDE-12345";
      expect(factorCode({ code }, method)).toBe(code);
    },
  );
  it.each([
    null,
    {},
    [],
    { code: 123456 },
    { code: "12345" },
    { code: "1234567" },
    { code: " 123456" },
    { code: "abcdef" },
  ])("rejects malformed TOTP %# without echoing input", (body) => {
    expect(() => factorCode(body, "totp")).toThrow(/^Invalid factor request$/);
  });
  it.each([
    "trustDevice",
    "disableSession",
    "userId",
    "sessionId",
    "elevatedAt",
    "stepUpAt",
    "mfa",
    "role",
    "permission",
  ])("rejects caller-controlled %s for both factors", (key) => {
    for (const method of ["totp", "recovery"] as const)
      expect(() =>
        factorCode(
          { code: method === "totp" ? "123456" : "abcDE-12345", [key]: true },
          method,
        ),
      ).toThrow(/^Invalid factor request$/);
  });
  it("standard-schema validation fails closed with a sanitized message", () => {
    const result = factorBody("totp")["~standard"].validate({
      code: "private-test-value",
    });
    expect(result).toEqual({ issues: [{ message: "Invalid factor request" }] });
  });
  it("native verification endpoints stay canonical and no HTTP assurance route is mounted", () => {
    const endpoints = preparationTwoFactor().endpoints;
    expect(endpoints.verifyTOTP.path).toBe("/two-factor/verify-totp");
    expect(endpoints.verifyBackupCode.path).toBe(
      "/two-factor/verify-backup-code",
    );
    for (const proof of [
      endpoints.completeTotpElevation,
      endpoints.completeRecoveryElevation,
      endpoints.completeTotpStepUp,
      endpoints.completeRecoveryStepUp,
    ])
      expect(proof.path).toBeUndefined();
  });
});
