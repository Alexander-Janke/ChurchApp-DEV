import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AssuranceModule } from "../auth/assurance.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { ChurchRepository } from "../church/church.repository.js";
import { MembershipRepository } from "../membership/membership.repository.js";
import { ChurchAdminController } from "./church-admin.controller.js";
import { ChurchAdminGuard } from "./church-admin.guard.js";
import { ChurchAdminService } from "./church-admin.service.js";
import { AdminAuditRepository } from "./admin-audit.repository.js";
import { AdminMutationLimiter } from "./admin-limiter.js";
@Module({
  imports: [AuthModule, AssuranceModule, AuthorizationModule, DatabaseModule],
  controllers: [ChurchAdminController],
  providers: [
    ChurchAdminGuard,
    ChurchAdminService,
    AdminAuditRepository,
    AdminMutationLimiter,
    TenantDatabase,
    ChurchRepository,
    MembershipRepository,
  ],
})
export class ChurchAdminModule {}
