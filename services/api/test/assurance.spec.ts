import { describe, it, expect, vi } from "vitest";
import {
  AssurancePolicy,
  ELEVATION_IDLE_MS,
  ELEVATION_MAX_MS,
  STEP_UP_MAX_MS,
  SECURE_ELEVATION_COMPLETION_ENABLED,
  requireSecureElevationCompletion,
  type AssuranceState,
} from "../src/auth/assurance-policy.js";
import { permissionAndAssurance } from "../src/authorization/assurance-requirements.js";
import { PERMISSIONS } from "../src/authorization/permission-policy.js";
import { SECURE_TOTP_VERIFICATION_ENABLED } from "../src/auth/auth-two-factor.js";

const origin = Date.UTC(2026, 0, 1);
const session = {
  createdAt: new Date(origin - 86400000),
  expiresAt: new Date(origin + 7 * 86400000),
};
const state = (overrides: Partial<AssuranceState> = {}): AssuranceState => ({
  elevatedAt: new Date(origin),
  lastElevatedActivityAt: new Date(origin),
  stepUpAt: new Date(origin),
  ...overrides,
});
const evaluate = (now: number, row: AssuranceState | null = state()) =>
  new AssurancePolicy(() => now).evaluate(session, row);

describe("session-bound assurance clock policy", () => {
  it("ordinary authentication has neither elevation nor step-up", () => {
    expect(evaluate(origin, null)).toEqual({
      authenticated: true,
      elevated: false,
      recentStepUp: false,
    });
  });
  it.each([-1, 0, 1])("15-minute inactivity boundary offset %i", (offset) => {
    expect(evaluate(origin + ELEVATION_IDLE_MS + offset).elevated).toBe(
      offset < 0,
    );
  });
  it.each([-1, 0, 1])(
    "8-hour absolute boundary despite recent activity offset %i",
    (offset) => {
      expect(
        evaluate(
          origin + ELEVATION_MAX_MS + offset,
          state({
            lastElevatedActivityAt: new Date(origin + ELEVATION_MAX_MS - 1000),
          }),
        ).elevated,
      ).toBe(offset < 0);
    },
  );
  it.each([-1, 0, 1])(
    "five-minute nonsliding step-up boundary offset %i",
    (offset) => {
      expect(evaluate(origin + STEP_UP_MAX_MS + offset).recentStepUp).toBe(
        offset < 0,
      );
    },
  );
  it("fresh activity does not refresh old step-up", () => {
    expect(
      evaluate(
        origin + 600000,
        state({ lastElevatedActivityAt: new Date(origin + 600000) }),
      ),
    ).toEqual({ authenticated: true, elevated: true, recentStepUp: false });
  });
  it("recent step-up cannot replace expired required elevation", () => {
    const actual = evaluate(
      origin + ELEVATION_IDLE_MS,
      state({ stepUpAt: new Date(origin + ELEVATION_IDLE_MS) }),
    );
    expect(actual).toEqual({
      authenticated: true,
      elevated: false,
      recentStepUp: true,
    });
    expect(
      permissionAndAssurance(
        true,
        { requiresPrivilegedAssurance: true, requiresRecentStepUp: true },
        actual,
      ),
    ).toBe(false);
  });
  it.each(["elevatedAt", "lastElevatedActivityAt", "stepUpAt"] as const)(
    "invalid %s fails closed",
    (key) => {
      const actual = evaluate(origin, state({ [key]: new Date(NaN) }));
      expect(key === "stepUpAt" ? actual.recentStepUp : actual.elevated).toBe(
        false,
      );
    },
  );
  it.each(["elevatedAt", "lastElevatedActivityAt", "stepUpAt"] as const)(
    "future %s fails closed",
    (key) => {
      const actual = evaluate(origin, state({ [key]: new Date(origin + 1) }));
      expect(key === "stepUpAt" ? actual.recentStepUp : actual.elevated).toBe(
        false,
      );
    },
  );
  it.each(["elevatedAt", "lastElevatedActivityAt", "stepUpAt"] as const)(
    "%s cannot predate its session",
    (key) => {
      const actual = evaluate(
        origin,
        state({ [key]: new Date(session.createdAt.getTime() - 1) }),
      );
      expect(key === "stepUpAt" ? actual.recentStepUp : actual.elevated).toBe(
        false,
      );
    },
  );
  it("activity before elevation is invalid", () => {
    expect(
      evaluate(origin, state({ lastElevatedActivityAt: new Date(origin - 1) }))
        .elevated,
    ).toBe(false);
  });
  it.each([
    null,
    { ...session, expiresAt: new Date(origin) },
    { ...session, createdAt: new Date(origin - 30 * 86400000) },
    { ...session, createdAt: new Date(origin + 1) },
    { ...session, createdAt: new Date(NaN) },
  ])(
    "missing/invalid/expired underlying session denies all assurance",
    (current) => {
      expect(
        new AssurancePolicy(() => origin).evaluate(current, state()),
      ).toEqual({ authenticated: false, elevated: false, recentStepUp: false });
    },
  );
  it("invalid clock denies even ordinary authentication", () => {
    expect(evaluate(NaN).authenticated).toBe(false);
  });
});

describe("permission and production completion boundaries", () => {
  const full = { authenticated: true, elevated: true, recentStepUp: true };
  const critical = {
    requiresPrivilegedAssurance: true,
    requiresRecentStepUp: true,
  };
  it("availability is code-owned and generic claims cannot issue assurance", () => {
    vi.stubEnv("SECURE_ELEVATION_COMPLETION_ENABLED", "false");
    try {
      expect(SECURE_ELEVATION_COMPLETION_ENABLED).toBe(true);
      expect(SECURE_TOTP_VERIFICATION_ENABLED).toBe(true);
      expect(() => requireSecureElevationCompletion()).toThrow(
        "verified factor operation",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("assurance cannot manufacture a permission", () => {
    expect(permissionAndAssurance(false, critical, full)).toBe(false);
  });
  it("explicit test-only critical metadata requires both independent proofs", () => {
    expect(permissionAndAssurance(true, critical, full)).toBe(true);
    expect(
      permissionAndAssurance(true, critical, { ...full, elevated: false }),
    ).toBe(false);
    expect(
      permissionAndAssurance(true, critical, { ...full, recentStepUp: false }),
    ).toBe(false);
  });
  it("elevation-only test capability does not require fresh critical proof", () => {
    expect(
      permissionAndAssurance(
        true,
        { ...critical, requiresRecentStepUp: false },
        { ...full, recentStepUp: false },
      ),
    ).toBe(true);
  });
  it("unknown or incomplete metadata denies instead of defaulting to ordinary access", () => {
    expect(permissionAndAssurance(true, undefined, full)).toBe(false);
    const incomplete = {
      requiresPrivilegedAssurance: false,
    } as typeof critical;
    expect(permissionAndAssurance(true, incomplete, full)).toBe(false);
  });
  it("ordinary permissions still require a valid normal session", () => {
    expect(
      permissionAndAssurance(true, PERMISSIONS["members.view"], {
        authenticated: false,
        elevated: false,
        recentStepUp: false,
      }),
    ).toBe(false);
  });
  it("requirements are immutable and no privileged catalog key is activated", () => {
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    for (const meta of Object.values(PERMISSIONS)) {
      expect(Object.isFrozen(meta)).toBe(true);
      expect(meta.requiresPrivilegedAssurance).toBe(false);
      expect(meta.requiresRecentStepUp).toBe(false);
    }
  });
});
