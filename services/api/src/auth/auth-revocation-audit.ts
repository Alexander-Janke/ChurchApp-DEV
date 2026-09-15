import { eq, sql } from "drizzle-orm";
import type { GenericEndpointContext } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
  isAPIError,
  revokeSession,
  revokeSessions,
  revokeOtherSessions,
  signOut,
} from "better-auth/api";
import { session, user } from "../database/schema/auth.js";
import { AuthTransaction } from "./auth-transaction.js";
import { AuthSecurityEventService } from "./auth-security-event.service.js";
import { AuthSessionPolicy } from "./auth-session-policy.js";

type Mode = "current" | "specific" | "others" | "all";
export function auditedSessionRevocation(database: AuthTransaction) {
  async function execute(
    ctx: GenericEndpointContext,
    mode: Mode,
    native: () => Promise<{
      response: Record<string, unknown>;
      headers: Headers;
    }>,
  ) {
    try {
      const result = await database.run(async (tx) => {
        const original = await getSessionFromCtx(ctx);
        if (!original) {
          if (mode === "current") return native(); // Idempotent anonymous logout.
          throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
        }
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, original.user.id))
          .for("update");
        const current = await ctx.context.internalAdapter.findSession(
          original.session.token,
        );
        if (
          !current ||
          current.user.id !== original.user.id ||
          new AuthSessionPolicy().isExpired(current.session)
        )
          throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
        ctx.context.session = current;
        const before = await tx
          .select()
          .from(session)
          .where(eq(session.userId, current.user.id))
          .for("update");
        const expected = before.filter(
          (row) =>
            mode === "all" ||
            (mode === "current" && row.id === current.session.id) ||
            (mode === "specific" && row.token === ctx.body?.token) ||
            (mode === "others" &&
              row.id !== current.session.id &&
              row.expiresAt.getTime() > Date.now()),
        );
        const response = await native();
        const after = await tx
          .select({ id: session.id })
          .from(session)
          .where(eq(session.userId, current.user.id));
        if (
          expected.some((row) =>
            after.some((remaining) => remaining.id === row.id),
          )
        )
          throw new Error("Session revocation incomplete");
        const events = new AuthSecurityEventService();
        for (const removed of before.filter(
          (row) => !after.some((remaining) => remaining.id === row.id),
        )) {
          await events.record(tx, {
            eventType: "session_revoked",
            actorUserId: current.user.id,
            subjectUserId: current.user.id,
            sessionId: removed.id,
            metadata: {},
          });
        }
        return response;
      });
      result.headers.forEach((value, name) => {
        if (name !== "set-cookie") ctx.setHeader(name, value);
      });
      for (const cookie of result.headers.getSetCookie())
        ctx.responseHeaders.append("set-cookie", cookie);
      return ctx.json(result.response);
    } catch (error) {
      if (isAPIError(error) && error.statusCode < 500) throw error;
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "SESSION_STORE_UNAVAILABLE",
        message: "Session operation could not be completed",
      });
    }
  }
  // Retain canonical middleware/input schemas and call canonical revocation. The
  // application before-hook still maps an owned public sessionId to its native token.
  return {
    id: "application-session-revocation-audit",
    endpoints: {
      revokeSession: createAuthEndpoint(
        "/revoke-session",
        revokeSession.options,
        (ctx) =>
          execute(ctx, "specific", () =>
            revokeSession({ ...ctx, asResponse: false, returnHeaders: true }),
          ),
      ),
      revokeSessions: createAuthEndpoint(
        "/revoke-sessions",
        revokeSessions.options,
        (ctx) =>
          execute(ctx, "all", () =>
            revokeSessions({ ...ctx, asResponse: false, returnHeaders: true }),
          ),
      ),
      revokeOtherSessions: createAuthEndpoint(
        "/revoke-other-sessions",
        revokeOtherSessions.options,
        (ctx) =>
          execute(ctx, "others", () =>
            revokeOtherSessions({
              ...ctx,
              asResponse: false,
              returnHeaders: true,
            }),
          ),
      ),
      signOut: createAuthEndpoint("/sign-out", signOut.options, (ctx) =>
        execute(ctx, "current", () =>
          signOut({ ...ctx, asResponse: false, returnHeaders: true }),
        ),
      ),
    },
  };
}
