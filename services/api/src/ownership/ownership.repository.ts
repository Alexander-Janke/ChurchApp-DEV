import { Injectable } from "@nestjs/common";
import { and, eq, asc, desc, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../database/database.types.js";
import { TenantContext } from "../database/tenant-context.js";
import { church } from "../database/schema/church.js";
import { churchMembership as membership } from "../database/schema/church-membership.js";
import {
  churchPrimaryOwner as owner,
  churchOwnershipAudit as audit,
} from "../database/schema/ownership.js";
import type { SessionSubject } from "../auth/session-assurance.service.js";

// Internal persistence only. All mutations include their audit insert in the SAME
// caller-owned transaction; this repository is not exported by OwnershipModule.
@Injectable()
export class OwnershipRepository {
  async requireProtection(tx: DatabaseTransaction) {
    const rows = await tx.execute(
      sql`select pg_has_role(current_user,c.relowner,'MEMBER') owns, c.relrowsecurity enabled, c.relforcerowsecurity forced from pg_class c where c.oid in ('public.church_primary_owner'::regclass,'public.church_ownership_audit'::regclass)`,
    );
    if (
      rows.rows.length !== 2 ||
      rows.rows.some((r) => r.owns || !r.enabled || !r.forced)
    )
      throw new Error("Protected ownership storage required");
  }
  async current(context: TenantContext, tx: DatabaseTransaction) {
    TenantContext.assert(context);
    const [row] = await tx
      .select()
      .from(owner)
      .where(eq(owner.churchId, context.churchId));
    return row ?? null;
  }
  async member(
    context: TenantContext,
    tx: DatabaseTransaction,
    id: string,
    lock = false,
  ) {
    TenantContext.assert(context);
    const query = tx
      .select()
      .from(membership)
      .where(
        and(eq(membership.churchId, context.churchId), eq(membership.id, id)),
      );
    const [row] = await (lock ? query.for("share") : query);
    return row ?? null;
  }
  async lockChurch(
    context: TenantContext,
    tx: DatabaseTransaction,
    shared = false,
  ) {
    TenantContext.assert(context);
    return (
      (
        await tx
          .select({ id: church.id })
          .from(church)
          .where(eq(church.id, context.churchId))
          .for(shared ? "share" : "update")
      ).length === 1
    );
  }
  async actorMembership(
    context: TenantContext,
    tx: DatabaseTransaction,
    userId: string,
  ) {
    TenantContext.assert(context);
    const [row] = await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.churchId, context.churchId),
          eq(membership.userId, userId),
        ),
      )
      .orderBy(asc(membership.id))
      .for("share");
    return row ?? null;
  }
  async change(
    context: TenantContext,
    tx: DatabaseTransaction,
    subject: SessionSubject,
    targetId: string,
    previousId: string | null,
  ): Promise<boolean> {
    TenantContext.assert(context);
    const rows =
      previousId === null
        ? await tx
            .insert(owner)
            .values({ churchId: context.churchId, membershipId: targetId })
            .onConflictDoNothing()
            .returning({ id: owner.churchId })
        : await tx
            .update(owner)
            .set({ membershipId: targetId, updatedAt: new Date() })
            .where(
              and(
                eq(owner.churchId, context.churchId),
                eq(owner.membershipId, previousId),
              ),
            )
            .returning({ id: owner.churchId });
    if (!rows.length) return false;
    await tx.insert(audit).values({
      churchId: context.churchId,
      eventType:
        previousId === null
          ? "initial_owner_established"
          : "ownership_transferred",
      previousOwnerMembershipId: previousId,
      newOwnerMembershipId: targetId,
      actorUserId: subject.userId,
      actorSessionId: subject.sessionId,
    });
    return true;
  }
  async recentAudit(
    context: TenantContext,
    tx: DatabaseTransaction,
    limit = 50,
  ) {
    TenantContext.assert(context);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid audit page");
    return tx
      .select()
      .from(audit)
      .where(eq(audit.churchId, context.churchId))
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(limit);
  }
}
