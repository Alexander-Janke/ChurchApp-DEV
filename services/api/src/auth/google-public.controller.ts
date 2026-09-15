import {
  Controller,
  BadRequestException,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "@thallesp/nestjs-better-auth";
import type { Request, Response } from "express";
import type { createBetterAuth } from "./auth.config.js";
import { getBetterAuthUrl } from "./auth.config.js";
import {
  GOOGLE_AUTHENTICATION_ENABLED,
  googleInput,
} from "./google-pre-auth-policy.js";
import {
  GooglePublicLimiter,
  GooglePublicRateLimitError,
} from "./google-public-policy.js";

type Auth = ReturnType<typeof createBetterAuth>;

function requestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function sourceKey(request: Request): string {
  // Express is not configured to trust forwarded headers. Use the connected
  // socket so callers cannot rotate a limiter key with an arbitrary header.
  return request.socket.remoteAddress ?? "";
}

@Controller("google")
export class GooglePublicController {
  constructor(
    private readonly auth: AuthService<Auth>,
    private readonly limiter: GooglePublicLimiter,
  ) {}

  @Post("start")
  async start(@Req() request: Request, @Res() response: Response) {
    this.requireEnabled();
    this.requireOrigin(request);
    try {
      this.limiter.consume("initiation", sourceKey(request));
      const result = await this.auth.api.signInSocial({
        headers: requestHeaders(request),
        body: {},
        asResponse: true,
      });
      await this.forward(result, response);
    } catch (error) {
      this.raise(error);
    }
  }

  @Get("callback")
  async callback(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    this.requireEnabled();
    this.requireCallbackOrigin(request);
    let input: { code?: string; state?: string };
    try {
      input = googleInput(query, true);
    } catch {
      throw new BadRequestException("Invalid Google authentication request");
    }
    try {
      this.limiter.consume("callback", sourceKey(request));
      const result = await this.auth.api.callbackOAuth({
        headers: this.callbackHeaders(request),
        body: input,
        asResponse: true,
      });
      await this.forward(result, response);
    } catch (error) {
      this.raise(error);
    }
  }

  private requireEnabled(): void {
    // This is intentionally a fixed application gate. No environment value,
    // request field or native Better Auth route can turn it on.
    if (!GOOGLE_AUTHENTICATION_ENABLED)
      throw new NotFoundException("Not Found");
  }

  private requireOrigin(request: Request): void {
    if (request.headers.origin !== new URL(getBetterAuthUrl()).origin)
      throw new ForbiddenException("Untrusted request origin");
  }

  private requireCallbackOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (origin && origin !== new URL(getBetterAuthUrl()).origin)
      throw new ForbiddenException("Untrusted request origin");
  }

  private callbackHeaders(request: Request): Headers {
    const headers = requestHeaders(request);
    // Top-level OAuth navigations commonly omit Origin. The fixed server route
    // is trusted only after native state/nonce validation, so supply the
    // configured origin to the internal bridge without trusting request Host.
    headers.set("origin", new URL(getBetterAuthUrl()).origin);
    return headers;
  }

  private async forward(source: globalThis.Response, target: Response) {
    target.status(source.status);
    source.headers.forEach((value, name) => {
      if (name !== "set-cookie") target.setHeader(name, value);
    });
    for (const cookie of source.headers.getSetCookie())
      target.append("Set-Cookie", cookie);
    const body = Buffer.from(await source.arrayBuffer());
    target.send(body);
  }

  private raise(error: unknown): never {
    if (error instanceof GooglePublicRateLimitError)
      throw new HttpException(
        "Google authentication is busy",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    throw new UnauthorizedException("Google authentication failed");
  }
}
