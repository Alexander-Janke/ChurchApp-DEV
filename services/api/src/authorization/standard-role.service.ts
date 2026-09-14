import type { DatabaseTransaction } from "../database/database.types.js";
import { Injectable } from "@nestjs/common";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { StandardRoleConflictError } from "./standard-roles.js";

function uniqueConflict(error: unknown): boolean {
  // Drizzle wraps PostgreSQL errors. Read only the bounded code/cause chain;
  // never expose driver diagnostics, names, identifiers or connection details.
  for (
    let depth = 0;
    depth < 3 && error && typeof error === "object";
    depth++
  ) {
    if ("code" in error && error.code === "23505") return true;
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}
@Injectable()
export class StandardRoleService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: AuthorizationRepository,
  ) {}
  // Internal outer-transaction variant; canonical definitions remain in the
  // existing repository. Caller must roll back on failure, never swallow it.
  ensureStandardRolesInTransaction(
    context: TenantContext,
    tx: DatabaseTransaction,
  ) {
    return this.tenants.inTransaction(context, tx, (bound) =>
      this.repository.ensureStandardRoles(context, bound),
    );
  }
  async ensureStandardRoles(context: TenantContext) {
    TenantContext.assert(context);
    try {
      return await this.tenants.transaction(context, (tx) =>
        this.repository.ensureStandardRoles(context, tx),
      );
    } catch (error) {
      if (error instanceof StandardRoleConflictError || uniqueConflict(error))
        throw new StandardRoleConflictError();
      throw new Error("Standard role provisioning failed");
    }
  }
}
