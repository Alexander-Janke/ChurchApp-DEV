import { StandardRoleService } from "./standard-role.service.js";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";

// Deliberately unmounted. No controller, public assignment endpoint or role seed.
@Module({
  imports: [DatabaseModule],
  providers: [
    TenantDatabase,
    AuthorizationRepository,
    AuthorizationService,
    StandardRoleService,
  ],
  exports: [AuthorizationRepository, AuthorizationService, StandardRoleService],
})
export class AuthorizationModule {}
