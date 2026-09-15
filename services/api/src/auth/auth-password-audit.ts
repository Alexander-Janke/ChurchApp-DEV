import { eq, sql } from "drizzle-orm";
import { Logger } from "@nestjs/common";
import type { GenericEndpointContext } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
  isAPIError,
  changePassword,
  resetPassword,
} from "better-auth/api";
import { session, user } from "../database/schema/auth.js";
import { AuthTransaction } from "./auth-transaction.js";
import { AuthSecurityEventService } from "./auth-security-event.service.js";
import { AuthSessionPolicy } from "./auth-session-policy.js";
import { revokePasswordSessions } from "./auth-password-policy.js";
import type { AuthEmailSender } from "./auth-email.js";

export function auditedPasswordOperations(
  database: AuthTransaction,
  mail: AuthEmailSender,
) {
  async function execute(
    ctx: GenericEndpointContext,
    reset: boolean,
    native: () => Promise<{
      response: Record<string, unknown>;
      headers: Headers;
    }>,
  ) {
    // Preserve the existing pre-storage reset length rejection. The native
    // endpoint still validates the same configured limits and owns password proof.
    if (
      reset &&
      (ctx.body.newPassword.length <
        ctx.context.password.config.minPasswordLength ||
        ctx.body.newPassword.length >
          ctx.context.password.config.maxPasswordLength)
    )
      throw new APIError("BAD_REQUEST", { message: "Invalid password length" });
    try {
      const result = await database.run(async (tx) => {
        const current = reset ? null : await getSessionFromCtx(ctx);
        // This read only selects a lock target. Native reset still validates and
        // atomically consumes its own credential; this lookup grants no authority.
        const pending = reset
          ? await ctx.context.internalAdapter.findVerificationValue(
              `reset-password:${ctx.body.token || ctx.query?.token || ""}`,
            )
          : null;
        const userId = current?.user.id ?? pending?.value;
        if (!userId)
          throw new APIError("BAD_REQUEST", {
            message: "Invalid password operation",
          });
        await tx.execute(sql`set local lock_timeout = '5s'`);
        const [owner] = await tx
          .select()
          .from(user)
          .where(eq(user.id, userId))
          .for("update");
        if (!owner)
          throw new APIError("BAD_REQUEST", {
            message: "Invalid password operation",
          });
        if (current) {
          const live = await ctx.context.internalAdapter.findSession(
            current.session.token,
          );
          if (
            !live ||
            live.user.id !== owner.id ||
            new AuthSessionPolicy().isExpired(live.session)
          )
            throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
          ctx.context.session = live;
        }
        const before = await tx
          .select({ id: session.id })
          .from(session)
          .where(eq(session.userId, owner.id))
          .for("update");
        const response = await native();
        if (!reset) await revokePasswordSessions(ctx);
        const after = await tx
          .select({ id: session.id })
          .from(session)
          .where(eq(session.userId, owner.id));
        if (reset && after.length)
          throw new Error("Password reset revocation incomplete");
        const events = new AuthSecurityEventService();
        await events.record(tx, {
          eventType: reset ? "password_reset" : "password_changed",
          actorUserId: owner.id,
          subjectUserId: owner.id,
          sessionId: current?.session.id ?? null,
          metadata: {},
        });
        for (const removed of before.filter(
          (row) => !after.some((remaining) => row.id === remaining.id),
        ))
          await events.record(tx, {
            eventType: "session_revoked",
            actorUserId: owner.id,
            subjectUserId: owner.id,
            sessionId: removed.id,
            metadata: {},
          });
        return { ...response, owner };
      });
      if (reset) {
        new Logger("AuthModule").log({
          event: "password_updated_by_recovery",
          userId: result.owner.id,
        });
        mail.dispatchPasswordChanged({
          recipient: result.owner.email,
          reason: "reset",
        });
      }
      result.headers.forEach((value, name) => {
        if (name !== "set-cookie") ctx.setHeader(name, value);
      });
      for (const cookie of result.headers.getSetCookie())
        ctx.responseHeaders.append("set-cookie", cookie);
      return ctx.json(result.response);
    } catch (error) {
      if (isAPIError(error) && error.statusCode < 500) throw error;
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Password operation unavailable",
      });
    }
  }
  return {
    id: "application-password-audit",
    endpoints: {
      changePassword: createAuthEndpoint(
        "/change-password",
        changePassword.options,
        (ctx) =>
          execute(ctx, false, () =>
            changePassword({ ...ctx, asResponse: false, returnHeaders: true }),
          ),
      ),
      resetPassword: createAuthEndpoint(
        "/reset-password",
        resetPassword.options,
        (ctx) =>
          execute(ctx, true, () =>
            resetPassword({ ...ctx, asResponse: false, returnHeaders: true }),
          ),
      ),
    },
  };
}
