import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OnboardingModule } from "./onboarding.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingGuard } from "./onboarding.guard.js";
import { OnboardingLimiter } from "./onboarding-limiter.js";

@Module({
  imports: [AuthModule, OnboardingModule],
  controllers: [OnboardingController],
  providers: [OnboardingGuard, OnboardingLimiter],
})
export class OnboardingHttpModule {}
