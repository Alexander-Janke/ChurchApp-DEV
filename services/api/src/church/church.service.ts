import { Injectable } from "@nestjs/common";
import { TenantContext } from "../database/tenant-context.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { ChurchRepository } from "./church.repository.js";

// No controller exposes this service. Future callers must establish entitlement.
@Injectable()
export class ChurchService {
  constructor(
    private readonly tenants: TenantDatabase,
    private readonly repository: ChurchRepository,
  ) {}
  getCurrentChurch(context: TenantContext) {
    return this.tenants.transaction(context, (tx) =>
      this.repository.getCurrentChurch(context, tx),
    );
  }
  updateCurrentChurch(context: TenantContext, input: unknown) {
    return this.tenants.transaction(context, (tx) =>
      this.repository.updateCurrentChurch(context, tx, input),
    );
  }
}
