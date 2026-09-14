import { twoFactor } from "better-auth/plugins";
import { APIError, createAuthEndpoint } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";

// Code-owned gate, deliberately not an environment switch. Task 1.7b requires
// separate review before replacing these endpoints with a replay-safe verifier.
export const SECURE_TOTP_VERIFICATION_ENABLED = false;
export const TWO_FACTOR_ISSUER = "Church Platform";

function blockedVerification(path: string) {
  return createAuthEndpoint(path, { method: "POST" }, async () => {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "SECOND_FACTOR_UNAVAILABLE",
      message: "Second-factor verification is not available",
    });
  });
}

export function preparationTwoFactor() {
  if (SECURE_TOTP_VERIFICATION_ENABLED !== false) {
    throw new Error(
      "Secure second-factor verification requires a reviewed implementation",
    );
  }
  const native = twoFactor({
    issuer: TWO_FACTOR_ISSUER,
    skipVerificationOnEnable: false,
    backupCodeOptions: { storeBackupCodes: "encrypted" },
  });
  // Retain canonical schema, credential challenge hooks and native rate limits.
  // Explicitly omit OTP, subsequent secret/code retrieval and server generators.
  return {
    ...native,
    endpoints: {
      enableTwoFactor: native.endpoints.enableTwoFactor,
      disableTwoFactor: native.endpoints.disableTwoFactor,
      generateBackupCodes: native.endpoints.generateBackupCodes,
      verifyTOTP: blockedVerification("/two-factor/verify-totp"),
      verifyBackupCode: blockedVerification("/two-factor/verify-backup-code"),
    },
  };
}

export function enforceTwoFactorPreparation(ctx: GenericEndpointContext) {
  // Reject even an existing native trusted-device cookie. No client or old
  // signed cookie may bypass a challenge while trusted devices are deferred.
  if (
    ctx.path === "/sign-in/email" &&
    ctx.getCookie(ctx.context.createAuthCookie("trust_device").name)
  ) {
    throw new APIError("FORBIDDEN", {
      code: "TRUSTED_DEVICE_UNAVAILABLE",
      message: "Trusted-device sign-in is not available",
    });
  }
  if (
    [
      "/two-factor/enable",
      "/two-factor/disable",
      "/two-factor/generate-backup-codes",
    ].includes(ctx.path)
  ) {
    const body: unknown = ctx.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "password")
    ) {
      throw new APIError("BAD_REQUEST", {
        code: "UNSUPPORTED_SECOND_FACTOR_FIELDS",
        message: "Second-factor request contains unsupported fields",
      });
    }
  }
}
