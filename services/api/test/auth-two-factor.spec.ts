import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, expect, it, vi } from "vitest";
import { createBetterAuth } from "../src/auth/auth.config.js";
import {
  preparationTwoFactor,
  SECURE_TOTP_VERIFICATION_ENABLED,
} from "../src/auth/auth-two-factor.js";
import * as schema from "../src/database/schema/index.js";

afterEach(() => vi.unstubAllEnvs());
function auth() {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "factor-test-only-not-a-runtime-secret-123456789",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
  return createBetterAuth(drizzle.mock({ schema }));
}
it.each(["test", "development", "production"])(
  "cannot enable the secure verifier through %s configuration",
  (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("SECURE_TOTP_VERIFICATION_ENABLED", "true");
    expect(SECURE_TOTP_VERIFICATION_ENABLED).toBe(false);
    expect(auth().options.session?.cookieCache?.enabled).toBe(false);
  },
);
it("mounts only password-protected preparation and blocked verification endpoints", () => {
  expect(Object.keys(preparationTwoFactor().endpoints).sort()).toEqual([
    "disableTwoFactor",
    "enableTwoFactor",
    "generateBackupCodes",
    "verifyBackupCode",
    "verifyTOTP",
  ]);
});
it("retains native endpoint rate limiting without email OTP or secret retrieval", () => {
  const plugin = preparationTwoFactor();
  expect(plugin.rateLimit?.[0]?.max).toBe(3);
  expect(plugin.rateLimit?.[0]?.window).toBe(10);
  expect(plugin.rateLimit?.[0]?.pathMatcher("/two-factor/enable")).toBe(true);
  expect("viewBackupCodes" in plugin.endpoints).toBe(false);
  expect("getTOTPURI" in plugin.endpoints).toBe(false);
  expect("sendTwoFactorOTP" in plugin.endpoints).toBe(false);
});
it.each(["verify-totp", "verify-backup-code"])(
  "fails closed on %s without returning submitted material",
  async (operation) => {
    const value = "sensitive-fixture-only";
    const res = await auth().handler(
      new Request("http://localhost:3001/api/v1/auth/two-factor/" + operation, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001",
        },
        body: JSON.stringify({ code: value, trustDevice: true }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: "SECOND_FACTOR_UNAVAILABLE",
      message: "Second-factor verification is not available",
    });
    expect(res.headers.has("set-cookie")).toBe(false);
  },
);
it("keeps native schema metadata and credential challenge hooks", () => {
  const plugin = preparationTwoFactor();
  expect(plugin.schema?.user?.fields.twoFactorEnabled?.input).toBe(false);
  expect(plugin.schema?.twoFactor?.fields.secret?.type).toBe("string");
  expect(plugin.hooks?.after?.length).toBeGreaterThan(0);
});
