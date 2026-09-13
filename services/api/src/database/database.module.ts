import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { getDatabaseUrl } from "./database.config.js";
import { DATABASE_POOL } from "./database.constants.js";
import { DatabaseService } from "./database.service.js";

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () =>
        new Pool({
          connectionString: getDatabaseUrl(),
          max: 10,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        }),
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
