import { factorBody } from "./factor-verification-policy.js";
import type { FactorAssurance } from "./factor-assurance.js";
import { twoFactor } from "better-auth/plugins";
import { APIError, createAuthEndpoint } from "better-auth/api";
import type { TwoFactorEnrollment } from "./two-factor-enrollment.js";
import { enrollmentInput } from "./two-factor-enrollment-policy.js";
import type { GenericEndpointContext } from "better-auth";

// KNOWN UPSTREAM LIMITATION — better-auth/better-auth#10387:
// Native cross-challenge TOTP replay is temporarily accepted, not fixed here.
export const SECURE_TOTP_VERIFICATION_ENABLED = true;
export const TWO_FACTOR_ISSUER = "Church Platform";

export function preparationTwoFactor(
  enrollment?: TwoFactorEnrollment,
  baseURL?: string,
  assurance?: FactorAssurance,
) {
  const native = twoFactor({
    issuer: TWO_FACTOR_ISSUER,
    skipVerificationOnEnable: false,
    backupCodeOptions: { storeBackupCodes: "encrypted" },
  });
  function coordinated(
    operation: "begin" | "confirm" | "disable" | "regenerate",
    path: string,
  ) {
    return createAuthEndpoint(
      path,
      { method: "POST", requireHeaders: true },
      async (ctx) => {
        if (!baseURL || ctx.headers?.get("origin") !== new URL(baseURL).origin)
          throw new APIError("FORBIDDEN", {
            message: "Untrusted request origin",
          });
        if (!enrollment)
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Enrollment operation unavailable",
          });
        const input = enrollmentInput(ctx.body, operation === "confirm");
        const result = await enrollment.execute(
          ctx,
          native.endpoints,
          operation,
          input,
        );
        result.headers.set("cache-control", "no-store");
        result.headers.set("pragma", "no-cache");
        result.headers.forEach((value, name) => {
          if (name !== "set-cookie") ctx.setHeader(name, value);
        });
        for (const cookie of result.headers.getSetCookie())
          ctx.responseHeaders.append("set-cookie", cookie);
        return ctx.json(result.response);
      },
    );
  }
  function complete(
    method: "totp" | "recovery",
    purpose: "elevation" | "step-up",
  ) {
    return createAuthEndpoint.serverOnly(
      { method: "POST", requireHeaders: true, body: factorBody(method) },
      async (ctx) => {
        if (!assurance)
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Assurance completion unavailable",
          });
        const response = await assurance.complete(
          ctx,
          native.endpoints,
          method,
          purpose,
        );
        ctx.setHeader("cache-control", "no-store");
        return ctx.json(response);
      },
    );
  }
  // Retain canonical schema, credential challenge hooks and native rate limits.
  // Explicitly omit OTP, subsequent secret/code retrieval and server generators.
  return {
    ...native,
    endpoints: {
      completeTotpElevation: complete("totp", "elevation"),
      completeRecoveryElevation: complete("recovery", "elevation"),
      completeTotpStepUp: complete("totp", "step-up"),
      completeRecoveryStepUp: complete("recovery", "step-up"),
      enableTwoFactor: coordinated("begin", "/two-factor/enable"),
      confirmEnrollment: coordinated(
        "confirm",
        "/two-factor/enrollment/confirm",
      ),
      disableTwoFactor: coordinated("disable", "/two-factor/disable"),
      generateBackupCodes: coordinated(
        "regenerate",
        "/two-factor/generate-backup-codes",
      ),
      verifyTOTP: native.endpoints.verifyTOTP,
      verifyBackupCode: native.endpoints.verifyBackupCode,
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
