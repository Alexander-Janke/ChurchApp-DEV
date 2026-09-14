import { EmailChangeService } from "./email-change.service.js";
import { Module } from "@nestjs/common";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { createBetterAuth, getBetterAuthUrl } from "./auth.config.js";
import { AuthEmailModule, AuthEmailSender } from "./auth-email.js";

@Module({
  imports: [
    BetterAuthModule.forRootAsync({
      imports: [DatabaseModule, AuthEmailModule],
      inject: [DatabaseService, AuthEmailSender],
      disableGlobalAuthGuard: true,
      useFactory: (
        database: DatabaseService,
        emailSender: AuthEmailSender,
      ) => ({
        auth: createBetterAuth(
          database.db,
          emailSender,
          undefined,
          new EmailChangeService(database, emailSender, getBetterAuthUrl()),
        ),
        bodyParser: {
          json: { enabled: true },
          urlencoded: { enabled: true, extended: true },
        },
      }),
    }),
  ],
})
export class AuthModule {}
