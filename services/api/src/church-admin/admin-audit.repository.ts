import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { churchAdminAudit } from "../database/schema/church-admin-audit.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { TenantContext } from "../database/tenant-context.js";
import type { SessionSubject } from "../auth/session-assurance.service.js";
import { SETTINGS_FIELDS } from "./admin-policy.js";
@Injectable()
export class AdminAuditRepository {
  async appendSettingsUpdated(
    context: TenantContext,
    tx: DatabaseTransaction,
    actor: SessionSubject,
    changedFields: readonly string[],
  ) {
    TenantContext.assert(context);
    if (changedFields.some((k) => !SETTINGS_FIELDS.some((f) => f === k)))
      throw new Error("Invalid audit fields");
    const result = await tx.execute(
      sql`select pg_has_role(current_user,c.relowner,'MEMBER') owns,c.relrowsecurity enabled,c.relforcerowsecurity forced from pg_class c where c.oid='public.church_admin_audit'::regclass`,
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0]!.owns ||
      !result.rows[0]!.enabled ||
      !result.rows[0]!.forced
    )
      throw new Error("Protected audit storage required");
    await tx.insert(churchAdminAudit).values({
      churchId: context.churchId,
      eventType: "church_settings_updated",
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      changedFields: [...new Set(changedFields)].sort(),
    });
  }
  // Internal bounded inspection, never an HTTP audit API. No update/delete methods.
  async list(context: TenantContext, tx: DatabaseTransaction) {
    TenantContext.assert(context);
    return tx
      .select()
      .from(churchAdminAudit)
      .where(eq(churchAdminAudit.churchId, context.churchId))
      .limit(100);
  }
}
