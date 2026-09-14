import { Injectable } from "@nestjs/common";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { AuthorizationRepository } from "./authorization.repository.js";

// Assignment evaluation only. Caller must derive membership from authenticated
// server identity; TenantContext is scope, not entitlement. Future protected work
// must re-evaluate via the repository in its SAME transaction and apply object,
// privacy and assurance requirements. There are no external mutation APIs.
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: AuthorizationRepository,
  ) {}
  async hasPermission(
    context: TenantContext,
    membershipId: string,
    permission: unknown,
  ): Promise<boolean> {
    TenantContext.assert(context);
    try {
      return await this.tenants.transaction(context, (tx) =>
        this.repository.hasPermission(context, tx, membershipId, permission),
      );
    } catch {
      // Database failure never grants permission or leaks assignment details.
      throw new Error("Authorization evaluation failed");
    }
  }
}
