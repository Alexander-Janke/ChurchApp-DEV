import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@thallesp/nestjs-better-auth";
import type { createBetterAuth } from "./auth.config.js";

// Application-owned boundary: consumers receive identity and transport headers, not library sessions.
@Injectable()
export class AuthSessionReader {
  constructor(
    private readonly auth: AuthService<ReturnType<typeof createBetterAuth>>,
  ) {}
  async resolve(cookie: string | undefined) {
    let result;
    try {
      const headers = new Headers();
      if (cookie) headers.set("cookie", cookie);
      result = await this.auth.instance.api.getSession({
        headers,
        returnHeaders: true,
      });
    } catch {
      throw new ServiceUnavailableException("Session verification unavailable");
    }
    if (!result.response?.user) throw new UnauthorizedException();
    return {
      userId: result.response.user.id,
      sessionId: result.response.session.id,
      cookies: result.headers.getSetCookie(),
    };
  }
}
