import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import type {
  SelfProfile,
  UpdateSelfProfileRequest,
} from "@church-platform/contracts";
import { ProfileService } from "./profile.service.js";
import { ProfilePatchPipe } from "./profile.dto.js";
import {
  PROFILE_ACTOR,
  ProfileGuard,
  type ProfileRequest,
} from "./profile.guard.js";
@Controller("profile/me")
@UseGuards(ProfileGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  @Get()
  read(@Req() req: ProfileRequest): Promise<SelfProfile> {
    return this.profiles.read(req[PROFILE_ACTOR]);
  }
  @Patch()
  update(
    @Req() req: ProfileRequest,
    @Body(new ProfilePatchPipe()) patch: UpdateSelfProfileRequest,
  ): Promise<SelfProfile> {
    return this.profiles.update(req[PROFILE_ACTOR], patch);
  }
}
