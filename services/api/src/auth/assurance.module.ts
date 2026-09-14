import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { SessionAssuranceService } from "./session-assurance.service.js";

// Internal service only; no controllers, issuers or test-fixture providers.
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: SessionAssuranceService,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new SessionAssuranceService(database),
    },
  ],
  exports: [SessionAssuranceService],
})
export class AssuranceModule {}
