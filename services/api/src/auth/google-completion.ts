import { and, eq, inArray, sql } from "drizzle-orm";
import type { GenericEndpointContext } from "better-auth";
import type { twoFactor as nativeTwoFactor } from "better-auth/plugins";
import { APIError, createAuthEndpoint, isAPIError } from "better-auth/api";
import {
  account,
  session,
  twoFactor,
  verification,
} from "../database/schema/auth.js";
import { AuthTransaction } from "./auth-transaction.js";
import { GooglePreAuth } from "./google-pre-auth.js";
import { challengeKey, challengeHash } from "./google-pre-auth-policy.js";
import {
  requireFactorOrigin,
  type FactorMethod,
} from "./factor-verification-policy.js";
import {
  googleCompletionInput,
  GoogleCompletionLimiter,
} from "./google-completion-policy.js";
import { AuthSecurityEventService } from "./auth-security-event.service.js";

type Native = ReturnType<typeof nativeTwoFactor>["endpoints"];
const denied = () =>
  new APIError("UNAUTHORIZED", {
    message: "Invalid factor or social challenge",
  });

// Signed native challenge transport is constructed on the server and NEVER sent
// to the browser. Use the supported cookie serializer, not custom cryptography.
const signInternalChallenge = createAuthEndpoint.serverOnly(
  { method: "POST", body: undefined },
  async (ctx) => {
    const cookie = ctx.context.createAuthCookie("two_factor");
    return ctx.setSignedCookie(
      cookie.name,
      ctx.query!.key as string,
      ctx.context.secret,
      cookie.attributes,
    );
  },
);

export class GoogleCompletion {
  private readonly limiter = new GoogleCompletionLimiter();
  constructor(
    private readonly database: AuthTransaction,
    private readonly bridge: GooglePreAuth,
  ) {}

  async complete(
    ctx: GenericEndpointContext,
    native: Native,
    method: FactorMethod,
  ) {
    ctx.setHeader("cache-control", "no-store");
    requireFactorOrigin(ctx);
    const input = googleCompletionInput(
      ctx.body,
      method,
      ctx.getCookie(ctx.context.createAuthCookie("social_pre_auth").name),
    );
    if (
      ctx.context.session ||
      ctx.getCookie(ctx.context.authCookies.sessionToken.name) ||
      ctx.getCookie(ctx.context.createAuthCookie("trust_device").name)
    )
      throw new APIError("CONFLICT", {
        message: "A separate sign-in context is required",
      });
    this.limiter.consume(input.challenge);
    try {
      const result = await this.database.run(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // Lookup only a lock target, never authority. User-first ordering agrees
        // with enrollment/disable; pending re-reads and locks the challenge.
        const key = challengeKey(input.challenge);
        const [lookup] = await tx
          .select({ value: verification.value })
          .from(verification)
          .where(eq(verification.id, key));
        let owner: unknown;
        try {
          owner = JSON.parse(lookup?.value ?? "null")?.userId;
        } catch {
          throw denied();
        }
        if (typeof owner !== "string") throw denied();
        const pending = await this.bridge.pending(tx, input.challenge, owner);
        // Protect provider/factor rows against direct concurrent updates too.
        await tx
          .select({ id: account.id })
          .from(account)
          .where(
            and(eq(account.userId, owner), eq(account.providerId, "google")),
          )
          .for("update");
        await tx
          .select({ id: twoFactor.id })
          .from(twoFactor)
          .where(eq(twoFactor.userId, owner))
          .for("update");
        await this.bridge.pending(tx, input.challenge, owner);
        const [source] = await tx
          .select()
          .from(verification)
          .where(eq(verification.id, pending.id));
        if (!source) throw denied();
        const nativeKey = "social-factor:" + challengeHash(input.challenge);
        const attemptsKey = "2fa-attempts-" + nativeKey;
        const existing =
          await ctx.context.internalAdapter.findVerificationValue(nativeKey);
        if (!existing) {
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: nativeKey,
            value: owner,
            expiresAt: source.expiresAt,
          });
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: attemptsKey,
            value: "0",
            expiresAt: source.expiresAt,
          });
        } else if (existing.value !== owner) throw denied();
        const signed = await signInternalChallenge({
          context: ctx.context,
          query: { key: nativeKey },
        });
        const headers = new Headers(ctx.headers);
        headers.set("cookie", signed.split(";")[0]!);
        const call = {
          ...ctx,
          headers,
          body: { code: input.code },
          asResponse: false as const,
          returnHeaders: true as const,
        };
        let verified;
        try {
          // Native sign-in mode verifies/consumes proof, updates attempt/lock state,
          // consumes the INTERNAL challenge, and inserts the normal session.
          // AuthTransaction routes every adapter write onto this same connection.
          verified =
            method === "totp"
              ? await native.verifyTOTP(call)
              : await native.verifyBackupCode(call);
        } catch (error) {
          // Only conclusive native proof failures may commit their attempt counters.
          // Storage/crypto/session/audit errors must abort the ENTIRE transaction.
          const code = isAPIError(error) ? error.body?.code : undefined;
          if (
            [
              "INVALID_CODE",
              "INVALID_BACKUP_CODE",
              "ACCOUNT_TEMPORARILY_LOCKED",
              "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
            ].includes(code ?? "")
          ) {
            if (code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") {
              await this.bridge.consumePending(tx, input.challenge, owner);
              await tx
                .delete(verification)
                .where(
                  inArray(verification.identifier, [nativeKey, attemptsKey]),
                );
            }
            return {
              failed:
                code === "ACCOUNT_TEMPORARILY_LOCKED" ||
                code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
                  ? 429
                  : 401,
            } as const;
          }
          throw error;
        }
        // Expiry and bindings are checked again after proof, before commit.
        await this.bridge.consumePending(tx, input.challenge, owner);
        const token = verified.response.token;
        if (typeof token !== "string")
          throw new Error("Missing session result");
        const [created] = await tx
          .select({ id: session.id })
          .from(session)
          .where(and(eq(session.token, token), eq(session.userId, owner)));
        if (!created) throw new Error("Missing session row");
        if (method === "recovery")
          await new AuthSecurityEventService().record(tx, {
            eventType: "recovery_code_used",
            actorUserId: owner,
            subjectUserId: owner,
            sessionId: created.id,
            metadata: { purpose: "authentication" },
          });
        await tx
          .delete(verification)
          .where(inArray(verification.identifier, [nativeKey, attemptsKey]));
        // Only the canonical application session cookie leaves the transaction.
        const cookies = verified.headers
          .getSetCookie()
          .filter((cookie) =>
            cookie.startsWith(ctx.context.authCookies.sessionToken.name + "="),
          );
        if (cookies.length !== 1) throw new Error("Missing session transport");
        return { cookies } as const;
      });
      if ("failed" in result) {
        if (result.failed === 429)
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Factor attempts limited",
          });
        throw denied();
      }
      for (const cookie of result.cookies)
        ctx.responseHeaders.append("set-cookie", cookie);
      const preAuth = ctx.context.createAuthCookie("social_pre_auth");
      ctx.setCookie(preAuth.name, "", { ...preAuth.attributes, maxAge: 0 });
      return ctx.json({ status: true });
    } catch (error) {
      if (isAPIError(error) && error.statusCode < 500)
        throw new APIError(
          error.statusCode === 429 ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED",
          { message: "Invalid factor or social challenge" },
        );
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Social completion unavailable",
      });
    }
  }
}
