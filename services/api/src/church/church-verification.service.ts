import { Injectable } from "@nestjs/common";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { ChurchRepository } from "./church.repository.js";
import type { VerificationRequestResult } from "./church-verification-policy.js";

// Internal request preparation only, with no HTTP caller. Future callers must
// authorize this specific action before supplying context; scope is not authority.
// Platform review persistence/assurance/audit remains deferred.
@Injectable()
export class ChurchVerificationService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: ChurchRepository,
  ) {}
  async requestVerification(
    context: TenantContext,
  ): Promise<VerificationRequestResult> {
    TenantContext.assert(context);
    try {
      return await this.tenants.transaction(context, (tx) =>
        this.repository.requestVerification(context, tx),
      );
    } catch {
      throw new Error("Church verification request failed");
    }
  }
}
