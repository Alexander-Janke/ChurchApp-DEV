import { OnboardingHttpModule } from "./onboarding/onboarding-http.module.js";
import { ProfileModule } from "./profile/profile.module.js";
import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HealthModule,
    ProfileModule,
    OnboardingHttpModule,
  ],
})
export class AppModule {}
