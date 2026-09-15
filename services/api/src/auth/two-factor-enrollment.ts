import { AuthSecurityEventService } from "./auth-security-event.service.js";
import { eq, sql } from "drizzle-orm";
import type { GenericEndpointContext } from "better-auth";
import { APIError, getSessionFromCtx, isAPIError } from "better-auth/api";
import type { twoFactor } from "better-auth/plugins";
import { user, session, twoFactor as factor } from "../database/schema/auth.js";
import { twoFactorEnrollment as enrollment } from "../database/schema/two-factor-enrollment.js";
import { AuthTransaction } from "./auth-transaction.js";
import { AuthSessionPolicy } from "./auth-session-policy.js";
import {
  ENROLLMENT_LIFETIME_MS,
  factorFingerprint,
  newEnrollmentId,
  isCurrentEnrollment,
  staleEnrollment,
} from "./two-factor-enrollment-policy.js";

type Native = ReturnType<typeof twoFactor>["endpoints"];
type Operation = "begin" | "confirm" | "disable" | "regenerate";

export class TwoFactorEnrollment {
  constructor(
    private readonly database: AuthTransaction,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async execute(
    ctx: GenericEndpointContext,
    native: Native,
    operation: Operation,
    input: { password?: string; enrollmentId?: string; code?: string },
  ) {
    const original = await getSessionFromCtx(ctx);
    if (!original)
      throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
    try {
      return await this.database.run(async (tx) => {
        // Stable row exists before the first generation. All application begin,
        // confirm and disable operations acquire this lock on the SAME connection
        // used by native adapter reads/writes. Works across app instances.
        await tx.execute(sql`set local lock_timeout = '5s'`);
        const [identity] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, original.user.id))
          .for("update");
        if (!identity) throw staleEnrollment();
        // Re-read AFTER locking: waiting must not preserve a revoked/expired session.
        const current = await ctx.context.internalAdapter.findSession(
          original.session.token,
        );
        if (
          !current ||
          current.session.id !== original.session.id ||
          current.user.id !== identity.id ||
          new AuthSessionPolicy(this.now).isExpired(current.session)
        )
          throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
        ctx.context.session = current;
        const factors = await tx
          .select()
          .from(factor)
          .where(eq(factor.userId, identity.id));
        if (factors.length > 1) throw staleEnrollment();
        const active = factors[0];
        if (
          (operation === "begin" || operation === "confirm") &&
          (current.user.twoFactorEnabled === true ||
            (active?.verified !== false && !!active))
        )
          throw staleEnrollment();
        const instant = this.now();
        if (!Number.isFinite(instant)) throw staleEnrollment();
        if (operation === "confirm") {
          const [pending] = await tx
            .select()
            .from(enrollment)
            .where(eq(enrollment.userId, identity.id));
          if (
            !active ||
            !isCurrentEnrollment(
              pending,
              identity.id,
              input.enrollmentId!,
              factorFingerprint(active.secret),
              instant,
            )
          )
            throw staleEnrollment();
        }
        // Public endpoint invocation keeps native password/crypto/storage logic.
        // The outer application endpoint owns transaction commit and response headers.
        const call = {
          ...ctx,
          asResponse: false as const,
          returnHeaders: true as const,
        };
        const result =
          operation === "begin"
            ? await native.enableTwoFactor({
                ...call,
                body: { password: input.password! },
              })
            : operation === "confirm"
              ? await native.verifyTOTP({
                  ...call,
                  body: { code: input.code! },
                })
              : operation === "regenerate"
                ? await native.generateBackupCodes({
                    ...call,
                    body: { password: input.password! },
                  })
                : await native.disableTwoFactor({
                    ...call,
                    body: { password: input.password! },
                  });
        if (operation === "regenerate") {
          await new AuthSecurityEventService().record(tx, {
            eventType: "recovery_codes_regenerated",
            actorUserId: identity.id,
            subjectUserId: identity.id,
            sessionId: current.session.id,
            metadata: {},
          });
          return result;
        }
        if (operation === "begin") {
          const [generated] = await tx
            .select()
            .from(factor)
            .where(eq(factor.userId, identity.id));
          if (!generated || generated.verified !== false)
            throw staleEnrollment();
          const id = newEnrollmentId();
          const values = {
            userId: identity.id,
            id,
            factorFingerprint: factorFingerprint(generated.secret),
            createdAt: new Date(instant),
            expiresAt: new Date(instant + ENROLLMENT_LIFETIME_MS),
          };
          await tx
            .insert(enrollment)
            .values(values)
            .onConflictDoUpdate({ target: enrollment.userId, set: values });
          return {
            response: { ...result.response, enrollmentId: id },
            headers: result.headers,
          };
        }
        if (operation === "confirm") {
          const [completed] = await tx
            .select()
            .from(factor)
            .where(eq(factor.userId, identity.id));
          if (
            !completed ||
            completed.verified !== true ||
            completed.secret !== active!.secret
          )
            throw staleEnrollment();
          // Native enrollment rotates an already-authenticated session. Preserve
          // original absolute age and verify there was no extra login session.
          const replacement = ctx.context.newSession;
          if (!replacement || replacement.user.id !== identity.id)
            throw staleEnrollment();
          await tx
            .update(session)
            .set({ createdAt: current.session.createdAt })
            .where(eq(session.id, replacement.session.id));
        }
        await new AuthSecurityEventService().record(tx, {
          eventType:
            operation === "confirm"
              ? "two_factor_enabled"
              : "two_factor_disabled",
          actorUserId: identity.id,
          subjectUserId: identity.id,
          sessionId: current.session.id,
          metadata: {},
        });
        await tx.delete(enrollment).where(eq(enrollment.userId, identity.id));
        return {
          response: { status: true, sessionRotated: true },
          headers: result.headers,
        };
      });
    } catch (error) {
      if (isAPIError(error)) throw error;
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Enrollment operation unavailable",
      });
    }
  }
}
