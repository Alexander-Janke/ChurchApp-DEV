import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantDatabase } from "../database/tenant-database.js";
import { ChurchRepository } from "./church.repository.js";
import { ChurchService } from "./church.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [TenantDatabase, ChurchRepository, ChurchService],
  exports: [ChurchService],
})
export class ChurchModule {}
