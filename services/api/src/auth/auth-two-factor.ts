import type { GoogleCompletion } from "./google-completion.js";
import { factorBody } from "./factor-verification-policy.js";
import type { FactorAssurance } from "./factor-assurance.js";
import { twoFactor } from "better-auth/plugins";
import { APIError, createAuthEndpoint, isAPIError } from "better-auth/api";
import type { TwoFactorEnrollment } from "./two-factor-enrollment.js";
import { enrollmentInput } from "./two-factor-enrollment-policy.js";
import type { GenericEndpointContext } from "better-auth";
import type { RecoveryCodeRedemption } from "./recovery-code-redemption.js";

// KNOWN UPSTREAM LIMITATION — better-auth/better-auth#10387:
// Native cross-challenge TOTP replay is temporarily accepted, not fixed here.
export const SECURE_TOTP_VERIFICATION_ENABLED = true;
export const TWO_FACTOR_ISSUER = "Church Platform";

export function preparationTwoFactor(
  enrollment?: TwoFactorEnrollment,
  baseURL?: string,
  assurance?: FactorAssurance,
  googleCompletion?: GoogleCompletion,
  recoveryRedemption?: RecoveryCodeRedemption,
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
  function completeGoogle(method: "totp" | "recovery") {
    return createAuthEndpoint(
      method === "totp"
        ? "/social/google/verify-totp"
        : "/social/google/verify-recovery-code",
      { method: "POST", requireHeaders: true },
      async (ctx) => {
        ctx.setHeader("cache-control", "no-store");
        if (!googleCompletion)
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Social completion unavailable",
          });
        return googleCompletion.complete(ctx, native.endpoints, method);
      },
    );
  }
  function verifyBackupCode() {
    if (!recoveryRedemption) return native.endpoints.verifyBackupCode;
    return createAuthEndpoint(
      "/two-factor/verify-backup-code",
      native.endpoints.verifyBackupCode.options,
      async (ctx) => {
        let result;
        try {
          result = await recoveryRedemption.signIn(
            ctx,
            native.endpoints.verifyBackupCode,
          );
        } catch (error) {
          if (isAPIError(error)) throw error;
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Recovery authentication unavailable",
          });
        }
        // Preserve Better Auth's canonical cookie/session transport. The
        // response middleware removes the bearer token from the JSON body.
        result.headers.forEach((value, name) => {
          if (name !== "set-cookie") ctx.setHeader(name, value);
        });
        for (const cookie of result.headers.getSetCookie())
          ctx.responseHeaders.append("set-cookie", cookie);
        return result.response;
      },
    );
  }
  // Retain canonical schema, credential challenge hooks and native rate limits.
  // Explicitly omit OTP, subsequent secret/code retrieval and server generators.
  return {
    ...native,
    rateLimit: [
      ...native.rateLimit,
      {
        pathMatcher: (path: string) =>
          path.startsWith("/social/google/verify-"),
        window: 60,
        max: 5,
      },
    ],
    endpoints: {
      completeGoogleTotp: completeGoogle("totp"),
      completeGoogleRecovery: completeGoogle("recovery"),
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
      verifyBackupCode: verifyBackupCode(),
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
