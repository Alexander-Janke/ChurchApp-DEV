import { GooglePreAuth, googlePreAuthPlugin } from "./google-pre-auth.js";
import { googleCredentials } from "./google-pre-auth-policy.js";
import { FactorAssurance } from "./factor-assurance.js";
import { AuthTransaction } from "./auth-transaction.js";
import { TwoFactorEnrollment } from "./two-factor-enrollment.js";
import type { DatabaseService } from "../database/database.service.js";
import { invalidateUserAssurance } from "./session-assurance.service.js";
import { preparationTwoFactor } from "./auth-two-factor.js";
import { emailChangePlugin } from "./email-change.plugin.js";
import type { EmailChangeService } from "./email-change.service.js";
import { betterAuth } from "better-auth";
import type { Database } from "../database/database.types.js";
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
  emailChanges?: EmailChangeService,
  transaction?: DatabaseService["transaction"],
) {
  if (emailSender.mode === "test" && process.env.NODE_ENV !== "test") {
    throw new AuthConfigurationError(
      "Test email delivery requires NODE_ENV=test",
    );
  }
  const authTransaction = new AuthTransaction(database, transaction);
  const enrollment = new TwoFactorEnrollment(authTransaction);
  const googleBridge = new GooglePreAuth(authTransaction);
  const google = googleCredentials();
  // Native social callbacks do not enforce the credential 2FA challenge.
  // The server-only bridge suppresses their session insertion; public Google
  // authentication remains disabled pending reviewed factor completion.
  return betterAuth({
    baseURL: getBetterAuthUrl(),
    socialProviders: google ? { google } : {},
    account: {
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    disabledPaths: [
      "/sign-in/social",
      "/callback/google",
      "/link-social",
      "/unlink-account",
      "/get-access-token",
      "/refresh-token",
      "/account-info",
      "/list-accounts",
    ],
    user: {
      changeEmail: { enabled: false, updateEmailWithoutVerification: false },
    },
    plugins: [
      googlePreAuthPlugin(googleBridge),
      emailChangePlugin(emailChanges, getBetterAuthUrl()),
      preparationTwoFactor(
        enrollment,
        getBetterAuthUrl(),
        new FactorAssurance(authTransaction),
      ),
    ],
    basePath: BETTER_AUTH_BASE_PATH,
    secret: getBetterAuthSecret(),
    database: authTransaction.adapter,
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
      user: {
        update: {
          before: async (data, ctx) => {
            // Native disable calls this AFTER password proof and BEFORE factor removal.
            // The enrollment coordinator commits invalidation and native factor
            // removal together, or rolls both back on failure.
            if (ctx?.path === "/two-factor/disable") {
              const current = ctx.context.session;
              if (!current || data.twoFactorEnabled !== false)
                throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
              try {
                await invalidateUserAssurance(
                  authTransaction.db,
                  current.user.id,
                );
              } catch {
                throw new APIError("SERVICE_UNAVAILABLE", {
                  message: "Assurance invalidation failed",
                });
              }
            }
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const suppressed = await googleBridge.beforeSession(
              session.userId,
              ctx,
            );
            if (suppressed === false) return false;
            // Native disable rotates its current session. Rotation must not reset
            // the application-owned absolute lifetime or use caller timestamps.
            if (ctx?.path === "/two-factor/disable") {
              const current = ctx.context.session;
              if (!current || current.user.id !== session.userId) {
                throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
              }
              return {
                data: { ...session, createdAt: current.session.createdAt },
              };
            }
          },
        },
      },
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
