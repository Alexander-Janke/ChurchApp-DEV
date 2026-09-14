import { describe, it, expect } from "vitest";
import {
  ENROLLMENT_LIFETIME_MS,
  newEnrollmentId,
  factorFingerprint,
  isCurrentEnrollment,
  enrollmentInput,
  staleEnrollment,
} from "../src/auth/two-factor-enrollment-policy.js";
import {
  SECURE_TOTP_VERIFICATION_ENABLED,
  preparationTwoFactor,
} from "../src/auth/auth-two-factor.js";
import { SECURE_ELEVATION_COMPLETION_ENABLED } from "../src/auth/assurance-policy.js";
const id = newEnrollmentId();
const start = Date.UTC(2026, 0, 1);
const row = {
  id,
  userId: "owner",
  factorFingerprint: factorFingerprint("ciphertext-fixture"),
  expiresAt: new Date(start + ENROLLMENT_LIFETIME_MS),
};
describe("enrollment generation policy", () => {
  it("generates unique server-owned opaque UUIDs", () => {
    const ids = Array.from({ length: 100 }, newEnrollmentId);
    expect(new Set(ids).size).toBe(100);
    expect(ids.every((value) => /^[0-9a-f-]{36}$/.test(value))).toBe(true);
  });
  it("fingerprints encrypted native material without retaining it", () => {
    expect(row.factorFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row.factorFingerprint).toBe(factorFingerprint("ciphertext-fixture"));
    expect(row.factorFingerprint).not.toBe(
      factorFingerprint("replacement-fixture"),
    );
    expect(row.factorFingerprint.includes("ciphertext-fixture")).toBe(false);
  });
  it.each([-1, 0, 1])("one-hour exact expiry boundary %i", (offset) => {
    expect(
      isCurrentEnrollment(
        row,
        "owner",
        id,
        row.factorFingerprint,
        start + ENROLLMENT_LIFETIME_MS + offset,
      ),
    ).toBe(offset < 0);
  });
  it("only the matching owned active generation can transition", () => {
    expect(
      isCurrentEnrollment(row, "owner", id, row.factorFingerprint, start),
    ).toBe(true);
    expect(
      isCurrentEnrollment(row, "other", id, row.factorFingerprint, start),
    ).toBe(false);
    expect(
      isCurrentEnrollment(
        row,
        "owner",
        newEnrollmentId(),
        row.factorFingerprint,
        start,
      ),
    ).toBe(false);
    expect(
      isCurrentEnrollment(row, "owner", id, "other-fingerprint", start),
    ).toBe(false);
    expect(
      isCurrentEnrollment(undefined, "owner", id, row.factorFingerprint, start),
    ).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])(
    "invalid server clock %s fails closed",
    (now) => {
      expect(
        isCurrentEnrollment(row, "owner", id, row.factorFingerprint, now),
      ).toBe(false);
    },
  );
  it("accepts only password for begin and generation/code for confirmation", () => {
    expect(enrollmentInput({ password: "test-only-password" }, false)).toEqual({
      password: "test-only-password",
    });
    expect(enrollmentInput({ enrollmentId: id, code: "123456" }, true)).toEqual(
      { enrollmentId: id, code: "123456" },
    );
  });
  it.each([
    {},
    null,
    [],
    { code: "123456" },
    { enrollmentId: id, code: "12345" },
    { enrollmentId: id, code: 123456 },
  ])("rejects malformed confirmation %#", (body) => {
    expect(() => enrollmentInput(body, true)).toThrow(
      "Invalid enrollment request",
    );
  });
  it.each([
    "userId",
    "sessionId",
    "verified",
    "trustDevice",
    "elevatedAt",
    "stepUpAt",
    "role",
  ])("rejects injected %s without echoing it", (field) => {
    expect(() =>
      enrollmentInput(
        { enrollmentId: id, code: "123456", [field]: "sensitive-fixture" },
        true,
      ),
    ).toThrow(/^Invalid enrollment request$/);
  });
  it("diagnostics expose neither proof nor generation material", () => {
    expect(staleEnrollment().message).toBe("Enrollment is no longer current");
  });
  it("enrollment coordination does not activate login or assurance", () => {
    expect(SECURE_TOTP_VERIFICATION_ENABLED).toBe(false);
    expect(SECURE_ELEVATION_COMPLETION_ENABLED).toBe(false);
    const plugin = preparationTwoFactor();
    expect(plugin.endpoints.confirmEnrollment.path).toBe(
      "/two-factor/enrollment/confirm",
    );
    expect(
      plugin.rateLimit![0]!.pathMatcher("/two-factor/enrollment/confirm"),
    ).toBe(true);
    expect(plugin.rateLimit![0]!.max).toBe(3);
  });
});
