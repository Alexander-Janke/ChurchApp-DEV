import { describe, it, expect, vi } from "vitest";
import {
  AUTH_SECURITY_EVENTS,
  validateAuthSecurityEvent,
} from "../src/auth/auth-security-event-policy.js";
import { AuthSecurityEventService } from "../src/auth/auth-security-event.service.js";
const base = {
  eventType: "two_factor_enabled",
  actorUserId: "user-a",
  subjectUserId: "user-a",
  sessionId: "session-a",
  metadata: {},
};
describe("authentication security-event policy", () => {
  it("uses only the closed current ADR event vocabulary", () => {
    expect(AUTH_SECURITY_EVENTS).toEqual([
      "password_changed",
      "password_reset",
      "email_changed",
      "two_factor_enabled",
      "two_factor_disabled",
      "recovery_codes_regenerated",
      "recovery_code_used",
      "session_revoked",
      "authentication_failure",
    ]);
  });
  it.each(
    AUTH_SECURITY_EVENTS.filter(
      (key) => !["recovery_code_used", "authentication_failure"].includes(key),
    ),
  )("accepts safe %s", (eventType) => {
    expect(validateAuthSecurityEvent({ ...base, eventType }).eventType).toBe(
      eventType,
    );
  });
  it.each(["authentication", "elevation", "step_up"])(
    "accepts recovery purpose %s",
    (purpose) => {
      expect(
        validateAuthSecurityEvent({
          ...base,
          eventType: "recovery_code_used",
          metadata: { purpose },
        }).metadata,
      ).toEqual({ purpose });
    },
  );
  it.each(["totp", "recovery", "password"])(
    "supports classified %s failures without inventing a trigger",
    (method) => {
      expect(
        validateAuthSecurityEvent({
          eventType: "authentication_failure",
          actorUserId: null,
          subjectUserId: null,
          sessionId: null,
          metadata: { method, category: "repeated" },
        }).actorUserId,
      ).toBeNull();
    },
  );
  it.each(["login_success", "google_login", "two_factor_reset", "unknown"])(
    "rejects undefined event %s",
    (eventType) => {
      expect(() => validateAuthSecurityEvent({ ...base, eventType })).toThrow(
        "Invalid authentication security event",
      );
    },
  );
  it.each([
    "password",
    "passwordHash",
    "totpCode",
    "totpSecret",
    "recoveryCode",
    "backupCodes",
    "authorizationCode",
    "accessToken",
    "refreshToken",
    "idToken",
    "sessionToken",
    "cookie",
    "authSecret",
    "requestBody",
    "exception",
    "ipAddress",
    "userAgent",
    "churchId",
  ])("rejects metadata field %s", (key) => {
    expect(() =>
      validateAuthSecurityEvent({
        ...base,
        metadata: { [key]: "private-test-value" },
      }),
    ).toThrow("Invalid authentication security event");
  });
  it.each(["id", "createdAt", "outcome", "tenantId", "permissions"])(
    "rejects caller-owned %s",
    (key) => {
      expect(() =>
        validateAuthSecurityEvent({ ...base, [key]: "untrusted" }),
      ).toThrow();
    },
  );
  it.each([null, "", "with spaces", "x".repeat(129)])(
    "rejects missing/unsafe success actor %#",
    (actorUserId) => {
      expect(() =>
        validateAuthSecurityEvent({ ...base, actorUserId }),
      ).toThrow();
    },
  );
  it("rejects wrong subject and missing revocation target", () => {
    expect(() =>
      validateAuthSecurityEvent({ ...base, subjectUserId: "other" }),
    ).toThrow();
    expect(() =>
      validateAuthSecurityEvent({
        ...base,
        eventType: "session_revoked",
        sessionId: null,
      }),
    ).toThrow();
  });
  it.each([
    "password_changed",
    "email_changed",
    "two_factor_enabled",
    "two_factor_disabled",
    "recovery_codes_regenerated",
  ])("requires the historical session for %s", (eventType) => {
    expect(() =>
      validateAuthSecurityEvent({ ...base, eventType, sessionId: null }),
    ).toThrow();
  });
  it("requires a session for recovery assurance proof but permits pre-session authentication evidence", () => {
    expect(() =>
      validateAuthSecurityEvent({
        ...base,
        eventType: "recovery_code_used",
        sessionId: null,
        metadata: { purpose: "step_up" },
      }),
    ).toThrow();
    expect(
      validateAuthSecurityEvent({
        ...base,
        eventType: "recovery_code_used",
        sessionId: null,
        metadata: { purpose: "authentication" },
      }).sessionId,
    ).toBeNull();
  });
  it("allows legitimate pre-session recovery/password-reset evidence", () => {
    expect(
      validateAuthSecurityEvent({
        ...base,
        eventType: "password_reset",
        sessionId: null,
      }).sessionId,
    ).toBeNull();
  });
  it.each([
    null,
    [],
    { purpose: "authentication", extra: "secret" },
    { purpose: { toString: (): string => "authentication" } },
  ])("rejects invalid recovery metadata %#", (metadata) => {
    expect(() =>
      validateAuthSecurityEvent({
        ...base,
        eventType: "recovery_code_used",
        metadata,
      }),
    ).toThrow();
  });
  it("rejects arbitrary exceptions and an undefined failure classification", () => {
    expect(() =>
      validateAuthSecurityEvent({
        ...base,
        eventType: "authentication_failure",
        metadata: { method: "totp", category: "typo" },
      }),
    ).toThrow();
  });
  it("has no read/update/delete/controller/authority surface", () => {
    expect(
      Object.getOwnPropertyNames(AuthSecurityEventService.prototype).sort(),
    ).toEqual(["constructor", "record", "recordFailure"]);
  });
  it("invalid input fails before any database operation", async () => {
    const insert = vi.fn();
    await expect(
      new AuthSecurityEventService().record(
        { insert } as never,
        { ...base, metadata: { password: "test-private" } } as never,
      ),
    ).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
});
