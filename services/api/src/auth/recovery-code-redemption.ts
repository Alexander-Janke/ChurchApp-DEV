import { and, eq, sql } from "drizzle-orm";
import type { GenericEndpointContext } from "better-auth";
import { APIError, isAPIError } from "better-auth/api";
import type { twoFactor } from "better-auth/plugins";
import { session, twoFactor as factor, user } from "../database/schema/auth.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { AuthTransaction } from "./auth-transaction.js";
import { AuthSecurityEventService } from "./auth-security-event.service.js";

type Native = ReturnType<typeof twoFactor>["endpoints"];
type NativeBackupCodeEndpoint = Native["verifyBackupCode"];

/**
 * Application-owned serialization boundary for recovery-code redemption.
 *
 * Better Auth 1.7.4's Drizzle adapter implements backup-code consumption as
 * an UPDATE whose predicate is a SELECT of the old encrypted value. Two
 * independent PostgreSQL transactions can therefore both select that value
 * before either UPDATE commits. Every application recovery consumer acquires
 * the canonical user and factor locks before invoking the native verifier.
 * The native verifier keeps the canonical encrypted representation and
 * cryptography, while this boundary makes its mutation single-winner across
 * processes and connections.
 */
export class RecoveryCodeRedemption {
  constructor(
    private readonly database: AuthTransaction,
    private readonly events = new AuthSecurityEventService(),
  ) {}

  /**
   * Lock and re-read the current factor state. Callers must invoke this inside
   * AuthTransaction.run so native adapter reads/writes share this connection.
   */
  async lockFactor(tx: DatabaseTransaction, userId: string) {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const [identity] = await tx
      .select({ id: user.id, twoFactorEnabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!identity || identity.twoFactorEnabled !== true)
      throw invalidRecoveryState();
    const [active] = await tx
      .select()
      .from(factor)
      .where(eq(factor.userId, userId))
      .for("update");
    if (!active || active.verified !== true) throw invalidRecoveryState();
    return { identity, factor: active };
  }

  /**
   * Ordinary Better Auth sign-in recovery. The native endpoint is called only
   * after the factor row is locked and re-read. Conclusive proof failures are
   * returned from the transaction so Better Auth's failure counters remain
   * durable; storage/session/audit failures throw and roll back all mutations.
   */
  async signIn(
    ctx: GenericEndpointContext,
    native: NativeBackupCodeEndpoint,
  ): Promise<{
    response: Record<string, unknown>;
    headers: Headers;
  }> {
    const result = await this.database.run(async (tx) => {
      const owner = await this.challengeOwner(ctx, tx);
      try {
        const verified = await native({
          ...ctx,
          asResponse: false as const,
          returnHeaders: true as const,
        });
        const response = verified.response as Record<string, unknown>;
        const token = response.token;
        if (typeof token !== "string")
          throw new Error("Missing recovery session result");
        const [created] = await tx
          .select({ id: session.id })
          .from(session)
          .where(and(eq(session.token, token), eq(session.userId, owner)));
        if (!created) throw new Error("Missing recovery session row");
        await this.events.record(tx, {
          eventType: "recovery_code_used",
          actorUserId: owner,
          subjectUserId: owner,
          sessionId: created.id,
          metadata: { purpose: "authentication" },
        });
        return {
          response,
          headers: verified.headers,
        };
      } catch (error) {
        // Native Better Auth persists failed-attempt state while returning a
        // conclusive API error. Commit that state, but never commit a session,
        // code consumption or success event for a failed proof.
        if (isAPIError(error) && error.statusCode < 500)
          return { failure: error } as const;
        throw error;
      }
    });
    if ("failure" in result) throw result.failure;
    return result;
  }

  private async challengeOwner(
    ctx: GenericEndpointContext,
    tx: DatabaseTransaction,
  ): Promise<string> {
    const cookie = ctx.context.createAuthCookie("two_factor");
    const key = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!key) throw invalidRecoveryState();
    // The signed verification value is the native challenge's owner binding;
    // it is used only as a lock target and is re-read after the row lock.
    const first = await ctx.context.internalAdapter.findVerificationValue(key);
    if (!first || typeof first.value !== "string") throw invalidRecoveryState();
    const owner = first.value;
    await this.lockFactor(tx, owner);
    const current =
      await ctx.context.internalAdapter.findVerificationValue(key);
    const expiresAt = current?.expiresAt
      ? new Date(current.expiresAt).getTime()
      : Number.NaN;
    if (
      !current ||
      current.value !== owner ||
      !Number.isFinite(expiresAt) ||
      Date.now() >= expiresAt
    )
      throw invalidRecoveryState();
    // Re-read the factor after waiting for the user lock. This second lookup
    // prevents stale state from being used after disable/regeneration commits.
    await this.lockFactor(tx, owner);
    return owner;
  }
}

function invalidRecoveryState(): APIError {
  return new APIError("UNAUTHORIZED", {
    code: "INVALID_TWO_FACTOR_COOKIE",
    message: "Invalid two-factor challenge",
  });
}
