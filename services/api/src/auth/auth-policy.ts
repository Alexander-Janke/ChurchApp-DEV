import { Logger } from "@nestjs/common";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { AuthEmailSender } from "./auth-email.js";

const SIGNUP_FIELDS = new Set(["name", "email", "password", "callbackURL"]);

export function createAuthPolicy(emailSender: AuthEmailSender) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/sign-up/email") {
      const body: unknown = ctx.body;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !SIGNUP_FIELDS.has(key))
      ) {
        // Do not echo field names or values from an authentication request.
        throw new APIError("BAD_REQUEST", {
          code: "UNSUPPORTED_SIGNUP_FIELDS",
          message: "Registration contains unsupported fields",
        });
      }
    }

    if (
      ctx.path === "/sign-up/email" ||
      ctx.path === "/send-verification-email"
    ) {
      try {
        emailSender.assertAvailable();
      } catch {
        // Gate BEFORE Better Auth writes: its background helper catches send errors.
        throw new APIError("SERVICE_UNAVAILABLE", {
          code: "AUTH_EMAIL_UNAVAILABLE",
          message: "Authentication email delivery is not configured",
        });
      }
    }
  });
}

// Library messages can contain submitted URLs, email addresses or database errors.
// Preserve severity without forwarding uncontrolled messages or arguments.
export function createAuthLogger() {
  const logger = new Logger("AuthModule");
  return {
    log(
      level: "debug" | "info" | "warn" | "error",
      _message: string,
      ..._details: unknown[]
    ) {
      if (level === "error") logger.error("Authentication operation failed");
      else if (level === "warn") logger.warn("Authentication request rejected");
    },
  };
}
