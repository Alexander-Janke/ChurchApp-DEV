import { Injectable } from "@nestjs/common";
import { and, eq, gt, asc } from "drizzle-orm";
import type { DatabaseTransaction } from "../database/database.types.js";
import { TenantContext } from "../database/tenant-context.js";
import { churchMembership as relationship } from "../database/schema/church-membership.js";
import {
  parseRelationshipCreation,
  parseRelationshipId,
  parseRelationshipPage,
  parseRelationshipTransition,
} from "./membership-policy.js";

// Internal persistence only. Selectors are not authorization. No user joins/private
// data, global pool fallback, ownership mutation or cross-tenant listing method.
@Injectable()
export class MembershipRepository {
  async getRelationshipById(
    context: TenantContext,
    tx: DatabaseTransaction,
    id: string,
  ) {
    TenantContext.assert(context);
    const [row] = await tx
      .select()
      .from(relationship)
      .where(
        and(
          eq(relationship.churchId, context.churchId),
          eq(relationship.id, parseRelationshipId(id)),
        ),
      );
    return row ?? null;
  }
  async getRelationshipForUser(
    context: TenantContext,
    tx: DatabaseTransaction,
    userId: string,
  ) {
    TenantContext.assert(context);
    const [row] = await tx
      .select()
      .from(relationship)
      .where(
        and(
          eq(relationship.churchId, context.churchId),
          eq(relationship.userId, parseRelationshipId(userId)),
        ),
      );
    return row ?? null;
  }
  async listRelationships(
    context: TenantContext,
    tx: DatabaseTransaction,
    limit = 50,
    after?: string,
  ) {
    TenantContext.assert(context);
    const page = parseRelationshipPage(limit, after);
    return tx
      .select()
      .from(relationship)
      .where(
        and(
          eq(relationship.churchId, context.churchId),
          page.after === undefined
            ? undefined
            : gt(relationship.id, page.after),
        ),
      )
      .orderBy(asc(relationship.id))
      .limit(page.limit);
  }
  async createRelationship(
    context: TenantContext,
    tx: DatabaseTransaction,
    input: unknown,
  ) {
    TenantContext.assert(context);
    const data = parseRelationshipCreation(input);
    const [row] = await tx
      .insert(relationship)
      .values({
        churchId: context.churchId,
        userId: data.userId,
        status: data.status,
      })
      .onConflictDoNothing({
        target: [relationship.churchId, relationship.userId],
      })
      .returning();
    return row
      ? { outcome: "created" as const, relationship: row }
      : { outcome: "already_exists" as const };
  }
  async changeRelationshipStatus(
    context: TenantContext,
    tx: DatabaseTransaction,
    id: string,
    expected: unknown,
    next: unknown,
  ) {
    TenantContext.assert(context);
    const change = parseRelationshipTransition(expected, next);
    const [row] = await tx
      .update(relationship)
      .set({ status: change.next, updatedAt: new Date() })
      .where(
        and(
          eq(relationship.churchId, context.churchId),
          eq(relationship.id, parseRelationshipId(id)),
          eq(relationship.status, change.expected),
        ),
      )
      .returning();
    // Missing/foreign/stale are intentionally indistinguishable.
    return row ?? null;
  }
}
