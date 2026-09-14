import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { MembershipRepository } from "./membership.repository.js";
import { MembershipService } from "./membership.service.js";
@Module({
  imports: [DatabaseModule],
  providers: [TenantDatabase, MembershipRepository, MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
