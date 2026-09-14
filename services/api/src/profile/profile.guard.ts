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
export const PROFILE_ACTOR = Symbol("profileActor");
export type ProfileRequest = Request & { [PROFILE_ACTOR]: string };
@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionReader) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ProfileRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("Cache-Control", "no-store");
    const actor = await this.sessions.resolve(req.headers.cookie);
    for (const cookie of actor.cookies) res.append("Set-Cookie", cookie);
    if (Object.keys(req.query).length)
      throw new BadRequestException("Profile query parameters are unsupported");
    // Same-origin browser writes only. CORS is not a substitute for CSRF protection.
    if (
      req.method === "PATCH" &&
      req.headers.origin !== new URL(getBetterAuthUrl()).origin
    )
      throw new ForbiddenException("Untrusted origin");
    req[PROFILE_ACTOR] = actor.userId;
    return true;
  }
}
