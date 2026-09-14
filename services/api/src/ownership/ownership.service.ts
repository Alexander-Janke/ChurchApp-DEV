import { Injectable } from "@nestjs/common";
import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { user, twoFactor, session } from "../database/schema/auth.js";
import { sessionAssurance } from "../database/schema/session-assurance.js";
import {
  SessionAssuranceService,
  type SessionSubject,
} from "../auth/session-assurance.service.js";
import { OwnershipRepository } from "./ownership.repository.js";
import {
  assertOwnershipSubject,
  eligibleOwner,
  mayTransfer,
  type OwnershipResult,
} from "./ownership-policy.js";
import { parseRelationshipId } from "../membership/membership-policy.js";

// Unmounted internal foundation. Context is authorized operation scope; actor MUST
// come from AuthSessionReader. Initial provisioning is self-establishment only and
// requires an authenticated recipient, never a fake admin or a caller identity DTO.
@Injectable()
export class OwnershipService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: OwnershipRepository,
    private readonly assurance: SessionAssuranceService,
  ) {}
  private async scoped<T>(
    context: TenantContext,
    subject: SessionSubject,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ) {
    TenantContext.assert(context);
    assertOwnershipSubject(subject);
    try {
      return await this.tenants.transaction(context, async (tx) => {
        await this.repository.requireProtection(tx);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        return work(tx);
      });
    } catch {
      throw new Error("Ownership operation failed");
    }
  }
  private async factorState(tx: DatabaseTransaction, userId: string) {
    const [identity] = await tx
      .select({ enabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, userId));
    const factors = await tx
      .select({ verified: twoFactor.verified })
      .from(twoFactor)
      .where(eq(twoFactor.userId, userId))
      .for("share");
    return {
      enabled: identity?.enabled === true,
      verified: factors.length === 1 && factors[0]?.verified === true,
    };
  }
  private async lockActor(tx: DatabaseTransaction, subject: SessionSubject) {
    const found = await tx
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.id, subject.sessionId),
          eq(session.userId, subject.userId),
        ),
      )
      .for("share");
    if (!found.length) return false;
    await tx
      .select({ id: sessionAssurance.sessionId })
      .from(sessionAssurance)
      .where(eq(sessionAssurance.sessionId, subject.sessionId))
      .for("share");
    return true;
  }
  async isPrimaryOwner(
    context: TenantContext,
    subject: SessionSubject,
  ): Promise<boolean> {
    return this.scoped(context, subject, async (tx) => {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, subject.userId))
        .for("share");
      if (!(await this.repository.lockChurch(context, tx, true))) return false;
      const current = await this.repository.current(context, tx);
      if (!current) return false;
      const member = await this.repository.member(
        context,
        tx,
        current.membershipId,
        true,
      );
      if (!(await this.lockActor(tx, subject))) return false;
      const factor = await this.factorState(tx, subject.userId);
      return (
        member?.userId === subject.userId &&
        eligibleOwner(member.status, factor.enabled, factor.verified) &&
        (await this.assurance.evaluate(subject, tx)).authenticated
      );
    });
  }
  establishInitialOwner(
    context: TenantContext,
    subject: SessionSubject,
    membershipId: string,
  ) {
    return this.mutate(
      context,
      subject,
      parseRelationshipId(membershipId),
      false,
    );
  }
  transferPrimaryOwner(
    context: TenantContext,
    subject: SessionSubject,
    membershipId: string,
  ) {
    return this.mutate(
      context,
      subject,
      parseRelationshipId(membershipId),
      true,
    );
  }
  private mutate(
    context: TenantContext,
    subject: SessionSubject,
    targetId: string,
    transfer: boolean,
  ): Promise<OwnershipResult> {
    return this.scoped(context, subject, async (tx) => {
      const candidate = await this.repository.member(context, tx, targetId);
      if (!candidate) return "not_found";
      // Match auth's user-before-session lock order. Sorted user locks avoid
      // competing recipient/actor order inversions. No sensitive columns selected.
      await tx
        .select({ id: user.id })
        .from(user)
        .where(
          inArray(user.id, [...new Set([subject.userId, candidate.userId])]),
        )
        .orderBy(asc(user.id))
        .for("share");
      if (!(await this.repository.lockChurch(context, tx))) return "not_found";
      const target = await this.repository.member(context, tx, targetId, true);
      if (!target || target.userId !== candidate.userId) return "not_found";
      const actor = await this.repository.actorMembership(
        context,
        tx,
        subject.userId,
      );
      if (
        !actor ||
        actor.status !== "member" ||
        !(await this.lockActor(tx, subject))
      )
        return "denied";
      const current = await this.repository.current(context, tx);
      if (!transfer && current) return "conflict";
      if (transfer && current?.membershipId !== actor.id) return "conflict";
      if (!transfer && target.userId !== subject.userId) return "denied";
      const recipientFactor = await this.factorState(tx, target.userId);
      const actorFactor = await this.factorState(tx, subject.userId);
      if (
        !eligibleOwner(
          target.status,
          recipientFactor.enabled,
          recipientFactor.verified,
        ) ||
        !eligibleOwner(actor.status, actorFactor.enabled, actorFactor.verified)
      )
        return "denied";
      // Final clock/assurance evaluation is AFTER all potentially blocking locks.
      const proof = await this.assurance.evaluate(subject, tx);
      if (
        transfer
          ? !mayTransfer(current?.membershipId === actor.id, proof)
          : !proof.authenticated
      )
        return "denied";
      if (current?.membershipId === target.id) return "unchanged";
      return (await this.repository.change(
        context,
        tx,
        subject,
        target.id,
        current?.membershipId ?? null,
      ))
        ? "changed"
        : "conflict";
    });
  }
}
