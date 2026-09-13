import { Module } from "@nestjs/common";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { createBetterAuth } from "./auth.config.js";

@Module({
  imports: [
    BetterAuthModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [DatabaseService],
      disableGlobalAuthGuard: true,
      useFactory: (database: DatabaseService) => ({
        auth: createBetterAuth(database.db),
        bodyParser: {
          json: { enabled: true },
          urlencoded: { enabled: true, extended: true },
        },
      }),
    }),
  ],
})
export class AuthModule {}
