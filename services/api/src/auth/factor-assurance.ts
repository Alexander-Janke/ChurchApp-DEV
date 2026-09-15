import { AuthSecurityEventService } from "./auth-security-event.service.js";
import { and, eq, sql } from "drizzle-orm";
import type { GenericEndpointContext } from "better-auth";
import type { twoFactor } from "better-auth/plugins";
import { APIError, getSessionFromCtx, isAPIError } from "better-auth/api";
import { user, session, twoFactor as factor } from "../database/schema/auth.js";
import { sessionAssurance } from "../database/schema/session-assurance.js";
import { AuthTransaction } from "./auth-transaction.js";
import { AssurancePolicy } from "./assurance-policy.js";
import {
  factorCode,
  requireFactorOrigin,
  type FactorMethod,
} from "./factor-verification-policy.js";

type Native = ReturnType<typeof twoFactor>["endpoints"];
// Internal proof operation, not an issuer accepting booleans or caller timestamps.
// Only the fixed server-only endpoint closures select the intended assurance scope.
export class FactorAssurance {
  constructor(
    private readonly database: AuthTransaction,
    private readonly policy = new AssurancePolicy(),
  ) {}
  async complete(
    ctx: GenericEndpointContext,
    native: Native,
    method: FactorMethod,
    purpose: "elevation" | "step-up",
  ) {
    requireFactorOrigin(ctx);
    const code = factorCode(ctx.body, method);
    const original = await getSessionFromCtx(ctx);
    if (!original)
      throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
    try {
      return await this.database.run(async (tx) => {
        // Same user lock as enrollment/disable; proof cannot race factor removal.
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, original.user.id))
          .for("update");
        const [owned] = await tx
          .select()
          .from(session)
          .where(
            and(
              eq(session.id, original.session.id),
              eq(session.userId, original.user.id),
            ),
          )
          .for("update");
        const current = await ctx.context.internalAdapter.findSession(
          original.session.token,
        );
        const [active] = await tx
          .select()
          .from(factor)
          .where(eq(factor.userId, original.user.id));
        if (
          !owned ||
          !current ||
          current.session.id !== owned.id ||
          !this.policy.evaluate(owned, null).authenticated ||
          current.user.twoFactorEnabled !== true ||
          active?.verified !== true
        )
          throw new APIError("UNAUTHORIZED", {
            message: "Verified factor and current session required",
          });
        ctx.context.session = current;
        // Native verification consumes recovery codes; TOTP uses the temporarily
        // accepted native semantics of better-auth/better-auth#10387.
        const call = {
          ...ctx,
          body: { code },
          asResponse: false as const,
          returnHeaders: true as const,
        };
        if (method === "totp") await native.verifyTOTP(call);
        else {
          await native.verifyBackupCode(call);
          await new AuthSecurityEventService().record(tx, {
            eventType: "recovery_code_used",
            actorUserId: current.user.id,
            subjectUserId: current.user.id,
            sessionId: owned.id,
            metadata: {
              purpose: purpose === "elevation" ? "elevation" : "step_up",
            },
          });
        }
        // No success flag, user ID, session ID or timestamp is accepted as proof.
        // Sample server time AFTER proof; sessions remain locked until commit.
        const now = this.policy.now();
        if (!new AssurancePolicy(() => now).evaluate(owned, null).authenticated)
          throw new APIError("UNAUTHORIZED", { message: "Session expired" });
        const instant = new Date(now);
        const update =
          purpose === "elevation"
            ? {
                elevatedAt: instant,
                lastElevatedActivityAt: instant,
                updatedAt: instant,
              }
            : { stepUpAt: instant, updatedAt: instant };
        await tx
          .insert(sessionAssurance)
          .values({ sessionId: owned.id, createdAt: instant, ...update })
          .onConflictDoUpdate({
            target: sessionAssurance.sessionId,
            set: update,
          });
        // Never forward native token/user output from the proof operation.
        return { status: true };
      });
    } catch (error) {
      if (isAPIError(error)) throw error;
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Assurance completion unavailable",
      });
    }
  }
}
