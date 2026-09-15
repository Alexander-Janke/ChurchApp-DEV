import type { GenericEndpointContext, Session } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import type { AuthSessionPolicy } from "./auth-session-policy.js";
import type { AuthEmailSender } from "./auth-email.js";
import { completePasswordChange } from "./auth-password-policy.js";
import {
  AuthenticationFailureClassifier,
  credentialFailureTarget,
  subjectFailureTarget,
} from "./auth-failure-classifier.js";

function unavailable(): APIError {
  return new APIError("SERVICE_UNAVAILABLE", {
    code: "SESSION_STORE_UNAVAILABLE",
    message: "Session operation could not be completed",
  });
}

// Runs for HTTP and auth.api calls, before native route middleware can use/refresh
// a session. Better Auth verifies the signed cookie and performs all DB operations.
export async function enforceSessionPolicy(
  ctx: GenericEndpointContext,
  policy: AuthSessionPolicy,
) {
  try {
    const token = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    let current = token
      ? await ctx.context.internalAdapter.findSession(token)
      : null;
    if (current && policy.isExpired(current.session)) {
      await ctx.context.internalAdapter.deleteSession(current.session.token);
      current = null;
      ctx.context.session = null;
      deleteSessionCookie(ctx);
    }

    if (ctx.path === "/revoke-session") {
      // ADR 0003 forbids returning bearer credentials to a session-management UI.
      // Translate an owned non-secret ID into the token the native endpoint needs.
      const body: unknown = ctx.body;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("sessionId" in body) ||
        typeof body.sessionId !== "string" ||
        !body.sessionId
      ) {
        throw new APIError("BAD_REQUEST", {
          code: "INVALID_SESSION_REFERENCE",
          message: "A sessionId is required",
        });
      }
      if (!current)
        throw new APIError("UNAUTHORIZED", {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        });
      const target = await ctx.context.adapter.findOne<Session>({
        model: "session",
        where: [
          { field: "id", value: body.sessionId },
          { field: "userId", value: current.user.id },
        ],
      });
      if (!target) return ctx.json({ status: true });
      return { context: { ...ctx, body: { token: target.token } } };
    }
  } catch (error) {
    if (isAPIError(error)) throw error;
    throw unavailable();
  }
}

function withoutToken<T extends { token: string }>(
  session: T,
): Omit<T, "token"> {
  const { token: _token, ...metadata } = session;
  return metadata;
}

export function createSessionResponsePolicy(
  policy: AuthSessionPolicy,
  emailSender: AuthEmailSender,
  failureClassifier?: AuthenticationFailureClassifier,
) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path.startsWith("/social/google/verify-"))
      ctx.setHeader("cache-control", "no-store");
    const returned = ctx.context.returned;
    if (isAPIError(returned)) {
      await classifyAuthenticationFailure(ctx, returned, failureClassifier);
      return;
    }
    await resetAuthenticationFailures(ctx, failureClassifier, returned);
    await completePasswordChange(ctx, emailSender);
    // No HTTP cache or ordinary JSON consumer may become session authority.
    ctx.setHeader("cache-control", "no-store");
    ctx.setHeader("pragma", "no-cache");
    if (
      ctx.path === "/two-factor/disable" &&
      returned &&
      typeof returned === "object" &&
      "status" in returned &&
      returned.status === true
    ) {
      return ctx.json({ status: true, sessionRotated: true });
    }
    try {
      if (ctx.path === "/sign-out") {
        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        // Native sign-out catches deletion errors; do not report success if its
        // server-side revocation did not actually complete.
        if (token && (await ctx.context.internalAdapter.findSession(token)))
          throw unavailable();
      }
      if (ctx.path === "/list-sessions" && Array.isArray(returned)) {
        const sessions: Omit<Session, "token">[] = [];
        for (const session of returned as Session[]) {
          if (policy.isExpired(session))
            await ctx.context.internalAdapter.deleteSession(session.token);
          else sessions.push(withoutToken(session));
        }
        return ctx.json(sessions);
      }
      if (
        returned &&
        typeof returned === "object" &&
        "session" in returned &&
        returned.session
      ) {
        return ctx.json({
          ...returned,
          session: withoutToken(returned.session as Session),
        });
      }
      if (
        returned &&
        typeof returned === "object" &&
        "token" in returned &&
        typeof returned.token === "string"
      ) {
        const { token: _token, ...response } = returned;
        return ctx.json(response);
      }
    } catch (error) {
      if (isAPIError(error)) throw error;
      throw unavailable();
    }
  });
}

function returnedUserId(returned: unknown): string | null {
  if (
    !returned ||
    typeof returned !== "object" ||
    !("user" in returned) ||
    !returned.user ||
    typeof returned.user !== "object" ||
    !("id" in returned.user) ||
    typeof returned.user.id !== "string"
  )
    return null;
  return returned.user.id;
}

async function twoFactorUserId(
  ctx: GenericEndpointContext,
): Promise<string | null> {
  try {
    const cookie = ctx.context.createAuthCookie("two_factor");
    const key = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!key) return null;
    const challenge =
      await ctx.context.internalAdapter.findVerificationValue(key);
    if (!challenge) return null;
    const user = await ctx.context.internalAdapter.findUserById(
      challenge.value,
    );
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function classifyAuthenticationFailure(
  ctx: GenericEndpointContext,
  error: APIError,
  classifier?: AuthenticationFailureClassifier,
): Promise<void> {
  if (!classifier) return;
  try {
    const code = error.body?.code;
    if (ctx.path === "/sign-in/email" && code === "INVALID_EMAIL_OR_PASSWORD") {
      const body = ctx.body as Record<string, unknown> | undefined;
      const target = credentialFailureTarget(body?.email);
      if (!target || typeof body?.password !== "string") return;
      let subjectUserId: string | null = null;
      try {
        const record = await ctx.context.internalAdapter.findUserByEmail(
          (body!.email as string).trim().toLowerCase(),
        );
        subjectUserId = record?.user.id ?? null;
      } catch {
        // A storage error is not a conclusive proof failure.
        return;
      }
      await classifier.observe({
        flow: "password",
        method: "password",
        target: subjectUserId ? subjectFailureTarget(subjectUserId) : target,
        subjectUserId,
      });
      return;
    }

    const factor =
      ctx.path === "/two-factor/verify-totp"
        ? ({ flow: "totp", method: "totp", code: "INVALID_CODE" } as const)
        : ctx.path === "/two-factor/verify-backup-code"
          ? ({
              flow: "recovery",
              method: "recovery",
              code: "INVALID_BACKUP_CODE",
            } as const)
          : null;
    if (!factor || code !== factor.code) return;
    const subjectUserId = await twoFactorUserId(ctx);
    if (!subjectUserId) return;
    await classifier.observe({
      flow: factor.flow,
      method: factor.method,
      target: subjectFailureTarget(subjectUserId),
      subjectUserId,
    });
  } catch {
    // Failure classification is post-failure observability and never changes
    // the sanitized authentication response.
  }
}

async function resetAuthenticationFailures(
  ctx: GenericEndpointContext,
  classifier?: AuthenticationFailureClassifier,
  returned?: unknown,
): Promise<void> {
  if (!classifier) return;
  try {
    if (ctx.path === "/sign-in/email") {
      const body = ctx.body as Record<string, unknown> | undefined;
      const target = credentialFailureTarget(body?.email);
      const userId = returnedUserId(returned);
      classifier.reset("password", [
        target ?? "",
        userId ? subjectFailureTarget(userId) : "",
      ]);
      return;
    }
    const flow =
      ctx.path === "/two-factor/verify-totp"
        ? "totp"
        : ctx.path === "/two-factor/verify-backup-code"
          ? "recovery"
          : null;
    if (!flow) return;
    const userId = returnedUserId(returned) ?? (await twoFactorUserId(ctx));
    if (userId) classifier.reset(flow, [subjectFailureTarget(userId)]);
  } catch {
    // Reset is best-effort transient state; durable history is untouched.
  }
}
