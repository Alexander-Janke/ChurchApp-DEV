import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { ChurchDetails } from "../church/church-policy.js";
import {
  ChurchOnboardingService,
  ChurchSlugConflictError,
  OnboardingDeniedError,
} from "./church-onboarding.service.js";
import {
  ONBOARDING_ACTOR,
  OnboardingGuard,
  type OnboardingRequest,
} from "./onboarding.guard.js";
import {
  mapOnboardingResponse,
  OnboardingInputPipe,
  type OnboardingResponse,
} from "./onboarding.dto.js";

@Controller("churches")
@UseGuards(OnboardingGuard)
export class OnboardingController {
  constructor(private readonly onboarding: ChurchOnboardingService) {}
  @Post()
  async create(
    @Req() req: OnboardingRequest,
    @Body(new OnboardingInputPipe()) details: ChurchDetails,
  ): Promise<OnboardingResponse> {
    try {
      return mapOnboardingResponse(
        await this.onboarding.createChurch(req[ONBOARDING_ACTOR], details),
      );
    } catch (error) {
      if (error instanceof OnboardingDeniedError)
        throw new ForbiddenException("Eligible authenticated creator required");
      if (error instanceof ChurchSlugConflictError)
        throw new ConflictException("Church slug is unavailable");
      throw new ServiceUnavailableException("Church onboarding unavailable");
    }
  }
}
