import { Injectable } from "@nestjs/common";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { MembershipRepository } from "./membership.repository.js";

// Unmounted: future callers must establish operation-specific entitlement first.
// Knowing a user/relationship ID or holding a context is not an authorization grant.
@Injectable()
export class MembershipService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: MembershipRepository,
  ) {}
  private async scoped<T>(
    context: TenantContext,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ) {
    TenantContext.assert(context);
    try {
      return await this.tenants.transaction(context, work);
    } catch {
      throw new Error("Membership operation failed");
    }
  }
  getRelationshipById(context: TenantContext, id: string) {
    return this.scoped(context, (tx) =>
      this.repository.getRelationshipById(context, tx, id),
    );
  }
  getRelationshipForUser(context: TenantContext, userId: string) {
    return this.scoped(context, (tx) =>
      this.repository.getRelationshipForUser(context, tx, userId),
    );
  }
  listRelationships(context: TenantContext, limit = 50, after?: string) {
    return this.scoped(context, (tx) =>
      this.repository.listRelationships(context, tx, limit, after),
    );
  }
  createRelationship(context: TenantContext, input: unknown) {
    return this.scoped(context, (tx) =>
      this.repository.createRelationship(context, tx, input),
    );
  }
  changeRelationshipStatus(
    context: TenantContext,
    id: string,
    expected: unknown,
    next: unknown,
  ) {
    return this.scoped(context, (tx) =>
      this.repository.changeRelationshipStatus(context, tx, id, expected, next),
    );
  }
}
