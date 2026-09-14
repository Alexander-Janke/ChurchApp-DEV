import { SessionAuthorizationService } from "./session-authorization.service.js";
import { AssuranceModule } from "../auth/assurance.module.js";
import { StandardRoleService } from "./standard-role.service.js";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";

// Shared internal services. No controller, public assignment endpoint or role seed.
@Module({
  imports: [DatabaseModule, AssuranceModule],
  providers: [
    TenantDatabase,
    AuthorizationRepository,
    AuthorizationService,
    StandardRoleService,
    SessionAuthorizationService,
  ],
  exports: [
    AuthorizationRepository,
    AuthorizationService,
    StandardRoleService,
    SessionAuthorizationService,
  ],
})
export class AuthorizationModule {}
