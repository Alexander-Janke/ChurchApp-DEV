import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "./database.service.js";
import type { DatabaseTransaction } from "./database.types.js";
import { TenantContext } from "./tenant-context.js";

@Injectable()
export class TenantDatabase {
  constructor(private readonly database: DatabaseService) {}
  async transaction<T>(
    context: TenantContext,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    TenantContext.assert(context);
    return this.database.transaction(async (tx) => {
      // Fail closed even if development/migration credentials are accidentally supplied.
      // Owner membership also permits SET ROLE; restricted runtime must have neither.
      const result = await tx.execute(sql`
        select r.rolsuper, r.rolbypassrls, r.rolcreaterole,
          pg_has_role(current_user, c.relowner, 'MEMBER') as owns,
          c.relrowsecurity, c.relforcerowsecurity
        from pg_roles r cross join pg_class c
        where r.rolname = current_user and c.oid in ('public.church'::regclass, 'public.church_membership'::regclass, 'public.church_role'::regclass, 'public.church_role_permission'::regclass, 'public.church_membership_role'::regclass)
      `);

      if (
        result.rows.length !== 5 ||
        result.rows.some(
          (role) =>
            role.rolsuper ||
            role.rolbypassrls ||
            role.rolcreaterole ||
            role.owns ||
            !role.relrowsecurity ||
            !role.relforcerowsecurity,
        )
      )
        throw new Error(
          "Restricted tenant database role and enforced RLS required",
        );
      await tx.execute(
        sql`select set_config('app.current_church_id', ${context.churchId}, true)`,
      );
      return work(tx);
    });
  }
}
