import type { GenericEndpointContext, Session } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import type { AuthSessionPolicy } from "./auth-session-policy.js";
import type { AuthEmailSender } from "./auth-email.js";
import { completePasswordChange } from "./auth-password-policy.js";

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
) {
  return createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned;
    if (isAPIError(returned)) return;
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
