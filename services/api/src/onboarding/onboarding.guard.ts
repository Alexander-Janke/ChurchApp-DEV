import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthSessionReader } from "../auth/auth-session-reader.js";
import { getBetterAuthUrl } from "../auth/auth.config.js";
import type { SessionSubject } from "../auth/session-assurance.service.js";
import { OnboardingLimiter } from "./onboarding-limiter.js";

export const ONBOARDING_ACTOR = Symbol("onboardingActor");
export type OnboardingRequest = Request & {
  [ONBOARDING_ACTOR]: SessionSubject;
};
@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionReader,
    private readonly limiter: OnboardingLimiter,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OnboardingRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("Cache-Control", "no-store");
    const actor = await this.sessions.resolve(req.headers.cookie);
    for (const cookie of actor.cookies) res.append("Set-Cookie", cookie);
    if (req.headers.origin !== new URL(getBetterAuthUrl()).origin)
      throw new ForbiddenException("Untrusted origin");
    this.limiter.consume(actor.userId);
    if (Object.keys(req.query).length)
      throw new BadRequestException(
        "Onboarding query parameters are unsupported",
      );
    req[ONBOARDING_ACTOR] = {
      userId: actor.userId,
      sessionId: actor.sessionId,
    };
    return true;
  }
}
