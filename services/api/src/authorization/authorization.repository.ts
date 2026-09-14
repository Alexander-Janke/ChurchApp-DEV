import { Injectable } from "@nestjs/common";
import { and, eq, gt, asc } from "drizzle-orm";
import type { DatabaseTransaction } from "../database/database.types.js";
import { TenantContext } from "../database/tenant-context.js";
import {
  churchRole as role,
  churchRolePermission as permission,
  churchMembershipRole as assignment,
} from "../database/schema/authorization.js";
import { churchMembership as membership } from "../database/schema/church-membership.js";
import {
  parseCustomRole,
  parseRoleId,
  parseRoleName,
  parseRolePage,
} from "./role-policy.js";
import {
  isPermissionKey,
  parsePermission,
  membershipAllowsPermission,
} from "./permission-policy.js";

// Internal persistence, not caller authorization. Every operation uses the caller's
// SAME tenant transaction. Future mutation APIs require separate entitlement/audit.
@Injectable()
export class AuthorizationRepository {
  async getRole(context: TenantContext, tx: DatabaseTransaction, id: string) {
    TenantContext.assert(context);
    const [row] = await tx
      .select()
      .from(role)
      .where(
        and(eq(role.churchId, context.churchId), eq(role.id, parseRoleId(id))),
      );
    return row ?? null;
  }
  async listRoles(
    context: TenantContext,
    tx: DatabaseTransaction,
    limit = 50,
    after?: string,
  ) {
    TenantContext.assert(context);
    const page = parseRolePage(limit, after);
    return tx
      .select()
      .from(role)
      .where(
        and(
          eq(role.churchId, context.churchId),
          page.after === undefined ? undefined : gt(role.id, page.after),
        ),
      )
      .orderBy(asc(role.id))
      .limit(page.limit);
  }
  async createRole(
    context: TenantContext,
    tx: DatabaseTransaction,
    input: unknown,
  ) {
    TenantContext.assert(context);
    const data = parseCustomRole(input);
    const [row] = await tx
      .insert(role)
      .values({
        churchId: context.churchId,
        name: data.name,
        description: data.description,
        isSystem: false,
      })
      .returning();
    return row!;
  }
  async renameRole(
    context: TenantContext,
    tx: DatabaseTransaction,
    id: string,
    name: unknown,
  ) {
    TenantContext.assert(context);
    const [row] = await tx
      .update(role)
      .set({ name: parseRoleName(name), updatedAt: new Date() })
      .where(
        and(
          eq(role.churchId, context.churchId),
          eq(role.id, parseRoleId(id)),
          eq(role.isSystem, false),
        ),
      )
      .returning();
    return row ?? null;
  }
  async deleteRole(
    context: TenantContext,
    tx: DatabaseTransaction,
    id: string,
  ) {
    TenantContext.assert(context);
    const rows = await tx
      .delete(role)
      .where(
        and(
          eq(role.churchId, context.churchId),
          eq(role.id, parseRoleId(id)),
          eq(role.isSystem, false),
        ),
      )
      .returning({ id: role.id });
    return rows.length === 1;
  }
  async addRolePermission(
    context: TenantContext,
    tx: DatabaseTransaction,
    roleId: string,
    key: unknown,
  ) {
    TenantContext.assert(context);
    const canonical = parsePermission(key);
    const target = await this.getRole(context, tx, roleId);
    if (!target || target.isSystem) return false;
    const rows = await tx
      .insert(permission)
      .values({
        churchId: context.churchId,
        roleId: target.id,
        permission: canonical,
      })
      .onConflictDoNothing()
      .returning();
    return rows.length === 1;
  }
  async removeRolePermission(
    context: TenantContext,
    tx: DatabaseTransaction,
    roleId: string,
    key: unknown,
  ) {
    TenantContext.assert(context);
    const canonical = parsePermission(key);
    const target = await this.getRole(context, tx, roleId);
    if (!target || target.isSystem) return false;
    const rows = await tx
      .delete(permission)
      .where(
        and(
          eq(permission.churchId, context.churchId),
          eq(permission.roleId, target.id),
          eq(permission.permission, canonical),
        ),
      )
      .returning();
    return rows.length === 1;
  }
  async assignRole(
    context: TenantContext,
    tx: DatabaseTransaction,
    membershipId: string,
    roleId: string,
  ) {
    TenantContext.assert(context);
    const target = await this.getRole(context, tx, roleId);
    const [subject] = await tx
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.churchId, context.churchId),
          eq(membership.id, parseRoleId(membershipId)),
        ),
      );
    if (!target || !subject) return false;
    const rows = await tx
      .insert(assignment)
      .values({
        churchId: context.churchId,
        roleId: target.id,
        membershipId: subject.id,
      })
      .onConflictDoNothing()
      .returning();
    return rows.length === 1;
  }
  async removeRole(
    context: TenantContext,
    tx: DatabaseTransaction,
    membershipId: string,
    roleId: string,
  ) {
    TenantContext.assert(context);
    const rows = await tx
      .delete(assignment)
      .where(
        and(
          eq(assignment.churchId, context.churchId),
          eq(assignment.membershipId, parseRoleId(membershipId)),
          eq(assignment.roleId, parseRoleId(roleId)),
        ),
      )
      .returning();
    return rows.length === 1;
  }
  async listMembershipRoles(
    context: TenantContext,
    tx: DatabaseTransaction,
    membershipId: string,
    limit = 50,
    after?: string,
  ) {
    TenantContext.assert(context);
    const page = parseRolePage(limit, after);
    return tx
      .select({ id: role.id, name: role.name, isSystem: role.isSystem })
      .from(assignment)
      .innerJoin(
        role,
        and(
          eq(role.churchId, assignment.churchId),
          eq(role.id, assignment.roleId),
        ),
      )
      .where(
        and(
          eq(assignment.churchId, context.churchId),
          eq(role.churchId, context.churchId),
          eq(assignment.membershipId, parseRoleId(membershipId)),
          page.after === undefined ? undefined : gt(role.id, page.after),
        ),
      )
      .orderBy(asc(role.id))
      .limit(page.limit);
  }
  async hasPermission(
    context: TenantContext,
    tx: DatabaseTransaction,
    membershipId: string,
    key: unknown,
  ): Promise<boolean> {
    TenantContext.assert(context);
    if (!isPermissionKey(key)) return false;
    // One current DB snapshot; no role-name checks, private user joins or cache.
    const [row] = await tx
      .select({ status: membership.status })
      .from(membership)
      .innerJoin(
        assignment,
        and(
          eq(assignment.churchId, membership.churchId),
          eq(assignment.membershipId, membership.id),
        ),
      )
      .innerJoin(
        role,
        and(
          eq(role.churchId, assignment.churchId),
          eq(role.id, assignment.roleId),
        ),
      )
      .innerJoin(
        permission,
        and(
          eq(permission.churchId, role.churchId),
          eq(permission.roleId, role.id),
        ),
      )
      .where(
        and(
          eq(membership.churchId, context.churchId),
          eq(assignment.churchId, context.churchId),
          eq(role.churchId, context.churchId),
          eq(permission.churchId, context.churchId),
          eq(membership.id, parseRoleId(membershipId)),
          eq(permission.permission, key),
        ),
      )
      .limit(1);
    return !!row && membershipAllowsPermission(row.status, key);
  }
}
