import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import type { Database } from "../database/database.types.js";
import * as authSchema from "../database/schema/auth.js";
import { BETTER_AUTH_BASE_PATH } from "./auth.constants.js";
import { AuthEmailSender, UnavailableAuthEmailSender } from "./auth-email.js";
import { createAuthLogger, createAuthPolicy } from "./auth-policy.js";
import {
  AuthSessionPolicy,
  WEB_SESSION_EXPIRES_IN,
  WEB_SESSION_UPDATE_AGE,
} from "./auth-session-policy.js";
import { createSessionResponsePolicy } from "./auth-session-hooks.js";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_RESET_EXPIRES_IN,
} from "./auth-password-policy.js";
import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";

const MIN_SECRET_LENGTH = 32;

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function getBetterAuthSecret(
  value = process.env.BETTER_AUTH_SECRET,
): string {
  if (!value?.trim()) {
    throw new AuthConfigurationError("BETTER_AUTH_SECRET is required");
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigurationError(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return value;
}

export function getBetterAuthUrl(value = process.env.BETTER_AUTH_URL): string {
  if (!value?.trim()) {
    throw new AuthConfigurationError("BETTER_AUTH_URL is required");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigurationError(
      "BETTER_AUTH_URL must be an absolute HTTP(S) URL",
    );
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname
  ) {
    throw new AuthConfigurationError(
      "BETTER_AUTH_URL must be an absolute HTTP(S) URL",
    );
  }

  return url.toString().replace(/\/$/, "");
}

export function createBetterAuth(
  database: Database,
  emailSender: AuthEmailSender = new UnavailableAuthEmailSender(),
  sessionPolicy: AuthSessionPolicy = new AuthSessionPolicy(),
) {
  if (emailSender.mode === "test" && process.env.NODE_ENV !== "test") {
    throw new AuthConfigurationError(
      "Test email delivery requires NODE_ENV=test",
    );
  }
  // Better Auth's default 2FA challenge covers credential sign-in but does not
  // automatically gate OAuth/social authentication; privileged assurance will
  // remain an application-owned check when those providers are added.
  return betterAuth({
    baseURL: getBetterAuthUrl(),
    basePath: BETTER_AUTH_BASE_PATH,
    secret: getBetterAuthSecret(),
    database: drizzleAdapter(database, { provider: "pg", schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => {
        // Delivery latency must not hold up only the existing-account response.
        emailSender.dispatchPasswordReset({
          recipient: user.email,
          url,
          token,
        });
      },
      onPasswordReset: async ({ user }) => {
        new Logger("AuthModule").log({
          event: "password_updated_by_recovery",
          userId: user.id,
        });
        emailSender.dispatchPasswordChanged({
          recipient: user.email,
          reason: "reset",
        });
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account, ctx) => {
            // Only signup creates local credentials. Native reset and server-only
            // setPassword must not enable deferred social-only password creation.
            if (
              account.providerId === "credential" &&
              ctx?.path !== "/sign-up/email"
            ) {
              throw new APIError("BAD_REQUEST", {
                code: "PASSWORD_CREATION_NOT_ENABLED",
                message: "Password creation is not enabled for this account",
              });
            }
          },
        },
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }) => {
        try {
          await emailSender.sendEmailVerification({
            recipient: user.email,
            url,
            token,
          });
        } catch {
          // Better Auth may log delivery failures through its background helper.
          throw new Error("Authentication email delivery failed");
        }
      },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // An accidental HTTP base URL must not weaken production cookies.
      ...(process.env.NODE_ENV === "production"
        ? { useSecureCookies: true }
        : {}),
    },
    session: {
      expiresIn: WEB_SESSION_EXPIRES_IN,
      updateAge: WEB_SESSION_UPDATE_AGE,
      cookieCache: { enabled: false },
    },
    hooks: {
      before: createAuthPolicy(emailSender, sessionPolicy),
      after: createSessionResponsePolicy(sessionPolicy, emailSender),
    },
    logger: createAuthLogger(),
  });
}
