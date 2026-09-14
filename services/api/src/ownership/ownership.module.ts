import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { AssuranceModule } from "../auth/assurance.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { OwnershipRepository } from "./ownership.repository.js";
import { OwnershipService } from "./ownership.service.js";

// Deliberately not imported into AppModule. No controllers or automatic provisioning.
@Module({
  imports: [DatabaseModule, AssuranceModule],
  providers: [TenantDatabase, OwnershipRepository, OwnershipService],
  exports: [OwnershipService],
})
export class OwnershipModule {}
