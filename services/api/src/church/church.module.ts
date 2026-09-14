import { ChurchVerificationService } from "./church-verification.service.js";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { ChurchRepository } from "./church.repository.js";
import { ChurchService } from "./church.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    TenantDatabase,
    ChurchRepository,
    ChurchService,
    ChurchVerificationService,
  ],
  exports: [ChurchService, ChurchVerificationService],
})
export class ChurchModule {}
