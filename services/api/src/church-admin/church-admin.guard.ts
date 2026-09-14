import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthSessionReader } from "../auth/auth-session-reader.js";
import { getBetterAuthUrl } from "../auth/auth.config.js";
import type { SessionSubject } from "../auth/session-assurance.service.js";
import { AdminMutationLimiter } from "./admin-limiter.js";
export const ADMIN_ACTOR = Symbol("adminActor");
export type AdminRequest = Request & { [ADMIN_ACTOR]: SessionSubject };
@Injectable()
export class ChurchAdminGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionReader,
    private readonly limiter: AdminMutationLimiter,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AdminRequest>(),
      res = context.switchToHttp().getResponse<Response>();
    res.setHeader("Cache-Control", "no-store");
    const actor = await this.sessions.resolve(req.headers.cookie);
    for (const cookie of actor.cookies) res.append("Set-Cookie", cookie);
    if (req.method === "PATCH") {
      if (req.headers.origin !== new URL(getBetterAuthUrl()).origin)
        throw new ForbiddenException("Untrusted origin");
      this.limiter.consume(actor.userId);
      if (Object.keys(req.query).length)
        throw new BadRequestException(
          "Settings query parameters are unsupported",
        );
    }
    req[ADMIN_ACTOR] = { userId: actor.userId, sessionId: actor.sessionId };
    return true;
  }
}
