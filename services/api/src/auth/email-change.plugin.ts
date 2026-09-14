import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import type { EmailChangeService } from "./email-change.service.js";
import {
  normalizeEmail,
  requireEmailChangeToken,
  singleField,
} from "./email-change-policy.js";

export function emailChangePlugin(
  service: EmailChangeService | undefined,
  baseURL: string,
) {
  const origin = new URL(baseURL).origin;
  function boundary(headers: Headers | undefined) {
    // Mandatory exact origin on ALL three POST routes, including token redemption.
    // No caller-selected callback or trust of X-Forwarded-Host.
    if (headers?.get("origin") !== origin)
      throw new APIError("FORBIDDEN", { message: "Untrusted request origin" });
    if (!service)
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Email change unavailable",
      });
    return service;
  }
  return {
    id: "application-email-change",
    endpoints: {
      requestEmailChange: createAuthEndpoint(
        "/email-change/request",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          const workflow = boundary(ctx.headers);
          const email = normalizeEmail(singleField(ctx.body, "newEmail"));
          const current = await getSessionFromCtx(ctx);
          if (!current)
            throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
          await workflow.request(
            { userId: current.user.id, sessionId: current.session.id },
            email,
          );
          return ctx.json({ status: true });
        },
      ),
      approveCurrentEmail: createAuthEndpoint(
        "/email-change/approve-current",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          const workflow = boundary(ctx.headers);
          await workflow.approve(
            requireEmailChangeToken(singleField(ctx.body, "token")),
          );
          return ctx.json({ status: true });
        },
      ),
      verifyNewEmail: createAuthEndpoint(
        "/email-change/verify-new",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          const workflow = boundary(ctx.headers);
          await workflow.verify(
            requireEmailChangeToken(singleField(ctx.body, "token")),
          );
          return ctx.json({ status: true });
        },
      ),
    },
    // The Better Auth router applies these to plugin endpoints too. Production
    // defaults to in-memory limiting; server auth.api calls are internal only.
    rateLimit: [
      {
        pathMatcher: (path: string) => path === "/email-change/request",
        window: 60,
        max: 3,
      },
      {
        pathMatcher: (path: string) =>
          path === "/email-change/approve-current" ||
          path === "/email-change/verify-new",
        window: 60,
        max: 10,
      },
    ],
  } satisfies BetterAuthPlugin;
}
