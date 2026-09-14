import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { ChurchRepository } from "../church/church.repository.js";
import { MembershipRepository } from "../membership/membership.repository.js";
import { OwnershipModule } from "../ownership/ownership.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ChurchOnboardingService } from "./church-onboarding.service.js";

// Deliberately unmounted in AppModule; no HTTP routes or automatic provisioning.
@Module({
  imports: [DatabaseModule, OwnershipModule, AuthorizationModule],
  providers: [
    TenantDatabase,
    ChurchRepository,
    MembershipRepository,
    ChurchOnboardingService,
  ],
  exports: [ChurchOnboardingService],
})
export class OnboardingModule {}
