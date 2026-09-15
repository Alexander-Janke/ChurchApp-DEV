import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, sql } from "drizzle-orm";
import type { GenericEndpointContext } from "better-auth";
import {
  APIError,
  callbackOAuth,
  signInSocial,
  createAuthEndpoint,
  isAPIError,
} from "better-auth/api";
import {
  user,
  account,
  verification,
  twoFactor,
  session,
} from "../database/schema/auth.js";
import type { DatabaseTransaction } from "../database/database.types.js";
import { AuthTransaction } from "./auth-transaction.js";
import {
  challengeHash,
  challengeKey,
  googleInput,
  googleBody,
  newSocialChallenge,
  SOCIAL_PRE_AUTH_LIFETIME_MS,
  GOOGLE_PUBLIC_COMPLETE_PATH,
  GOOGLE_PUBLIC_ERROR_PATH,
} from "./google-pre-auth-policy.js";

type Pending = {
  userId: string;
  accountId: string;
  provider: "google";
  accountFingerprint: string;
  factorFingerprint: string;
  eventId: string;
};
type CallbackScope = {
  pending?: { token: string };
  issued?: Parameters<typeof setSessionCookie>[1];
  checked: boolean;
  mintingFor?: string;
};
// Server-only bridge: native provider validation is retained; no public callback is mounted.
export class GooglePreAuth {
  private readonly callbacks = new AsyncLocalStorage<CallbackScope>();
  constructor(
    private readonly database: AuthTransaction,
    private readonly now = () => Date.now(),
  ) {}

  async beforeSession(userId: string, ctx: GenericEndpointContext | null) {
    if (
      ctx?.path !== "/callback/google" &&
      ctx?.path !== "/callback/:id" &&
      ctx?.path !== "/sign-in/social"
    )
      return;
    const scope = this.callbacks.getStore();
    if (scope?.mintingFor === userId) return;
    if (!scope || scope.checked)
      throw new APIError("FORBIDDEN", {
        message: "Google authentication unavailable",
      });
    scope.checked = true;
    return this.database.run(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const [identity] = await tx
        .select()
        .from(user)
        .where(eq(user.id, userId))
        .for("update");
      if (!identity)
        throw new APIError("UNAUTHORIZED", {
          message: "Invalid Google identity",
        });
      const factors = await tx
        .select()
        .from(twoFactor)
        .where(eq(twoFactor.userId, userId));
      if (identity.twoFactorEnabled !== true) {
        if (factors.some((f) => f.verified === true))
          throw new APIError("UNAUTHORIZED", {
            message: "Invalid factor state",
          });
        scope.mintingFor = identity.id;
        try {
          const created = await ctx!.context.internalAdapter.createSession(
            identity.id,
          );
          if (!created) throw new Error("Session creation failed");
          scope.issued = { session: created, user: identity };
        } finally {
          scope.mintingFor = undefined;
        }
        return false as const;
      }
      if (factors.length !== 1 || factors[0]?.verified !== true)
        throw new APIError("UNAUTHORIZED", {
          message: "Verified factor required",
        });
      const accounts = await tx
        .select({ id: account.id, subject: account.accountId })
        .from(account)
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "google")),
        );
      if (accounts.length !== 1)
        throw new APIError("UNAUTHORIZED", {
          message: "Ambiguous Google identity",
        });
      const token = newSocialChallenge();
      const instant = new Date(this.now());
      const value: Pending = {
        userId,
        accountId: accounts[0]!.id,
        provider: "google",
        accountFingerprint: challengeHash(accounts[0]!.subject),
        factorFingerprint: challengeHash(factors[0]!.secret),
        eventId: randomUUID(),
      };
      await tx.insert(verification).values({
        id: challengeKey(token),
        identifier: challengeKey(token),
        value: JSON.stringify(value),
        createdAt: instant,
        updatedAt: instant,
        expiresAt: new Date(instant.getTime() + SOCIAL_PRE_AUTH_LIFETIME_MS),
      });
      scope.pending = { token };
      // Supported before-create cancellation: no session INSERT, cookie or transient row.
      return false as const;
    });
  }

  // A future factor completion MUST call this under its same user-first transaction,
  // verify a real factor, then delete this row atomically with session creation.
  // This method does not consume proof, create sessions or issue assurance.
  async pending(
    tx: DatabaseTransaction,
    token: unknown,
    expectedUserId: string,
  ) {
    const key = challengeKey(token);
    const [identity] = await tx
      .select()
      .from(user)
      .where(eq(user.id, expectedUserId))
      .for("update");
    const [row] = await tx
      .select()
      .from(verification)
      .where(eq(verification.id, key))
      .for("update");
    const deny = () =>
      new APIError("UNAUTHORIZED", { message: "Invalid social challenge" });
    if (
      !identity ||
      !row ||
      row.identifier !== key ||
      row.expiresAt.getTime() <= this.now() ||
      row.createdAt.getTime() > this.now() ||
      row.createdAt.getTime() + SOCIAL_PRE_AUTH_LIFETIME_MS <= this.now() ||
      identity.twoFactorEnabled !== true
    )
      throw deny();
    let value: Pending;
    try {
      value = JSON.parse(row.value) as Pending;
    } catch {
      throw deny();
    }
    if (value.userId !== identity.id || value.provider !== "google")
      throw deny();
    const linked = await tx
      .select({ id: account.id, subject: account.accountId })
      .from(account)
      .where(
        and(
          eq(account.id, value.accountId),
          eq(account.userId, identity.id),
          eq(account.providerId, "google"),
        ),
      );
    const factors = await tx
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.userId, identity.id));
    if (
      linked.length !== 1 ||
      challengeHash(linked[0]!.subject) !== value.accountFingerprint ||
      factors.length !== 1 ||
      factors[0]?.verified !== true ||
      challengeHash(factors[0].secret) !== value.factorFingerprint
    )
      throw deny();
    return { id: row.id, userId: identity.id, eventId: value.eventId };
  }

  // Single-use storage primitive for cancellation/future reviewed completion. It
  // confers no authentication. Task 1.21b must prove the factor and create the
  // session in the SAME outer transaction, rolling consumption back on failure.
  async consumePending(
    tx: DatabaseTransaction,
    token: unknown,
    expectedUserId: string,
  ) {
    const pending = await this.pending(tx, token, expectedUserId);
    const removed = await tx
      .delete(verification)
      .where(eq(verification.id, pending.id))
      .returning({ id: verification.id });
    if (removed.length !== 1)
      throw new APIError("UNAUTHORIZED", {
        message: "Invalid social challenge",
      });
    return { userId: pending.userId, eventId: pending.eventId };
  }

  private requireCleanBrowser(ctx: GenericEndpointContext) {
    if (ctx.headers?.get("origin") !== new URL(ctx.context.baseURL).origin)
      throw new APIError("FORBIDDEN", { message: "Untrusted request origin" });
    if (
      ctx.getCookie(ctx.context.authCookies.sessionToken.name) ||
      ctx.getCookie(ctx.context.createAuthCookie("trust_device").name)
    )
      throw new APIError("CONFLICT", {
        message: "A separate sign-in context is required",
      });
  }
  async begin(ctx: GenericEndpointContext) {
    this.requireCleanBrowser(ctx);
    googleInput(ctx.body, false);
    return signInSocial()({
      ...ctx,
      body: {
        provider: "google",
        disableRedirect: true,
        callbackURL: new URL(GOOGLE_PUBLIC_COMPLETE_PATH, ctx.context.baseURL)
          .href,
        errorCallbackURL: new URL(GOOGLE_PUBLIC_ERROR_PATH, ctx.context.baseURL)
          .href,
      },
      asResponse: true,
    });
  }
  async callback(ctx: GenericEndpointContext) {
    this.requireCleanBrowser(ctx);
    const input = googleInput(ctx.body, true);
    const scope: CallbackScope = { checked: false };
    try {
      // Claim this callback event once BEFORE native state consumption. A PK makes
      // duplicate callbacks fail across instances, without holding a DB transaction
      // over Google's external token/profile requests. Failed attempts need new OAuth
      // initiation. Only a hash of state is retained; native signed-cookie/state
      // verification remains mandatory and is never replaced by this reservation.
      const eventKey = "google-callback-event:" + challengeHash(input.state!);
      const instant = new Date(this.now());
      const claim = await this.database.db
        .insert(verification)
        .values({
          id: eventKey,
          identifier: eventKey,
          value: "google-callback-claimed",
          createdAt: instant,
          updatedAt: instant,
          expiresAt: new Date(instant.getTime() + SOCIAL_PRE_AUTH_LIFETIME_MS),
        })
        .onConflictDoNothing()
        .returning({ id: verification.id });
      if (claim.length !== 1)
        throw new APIError("UNAUTHORIZED", {
          message: "Google authentication failed",
        });
      return await this.callbacks.run(scope, async () => {
        // External identity validation precedes the short user/factor/session
        // transaction in beforeSession. Native writes remain canonical Better Auth.
        const result = await callbackOAuth({
          ...ctx,
          path: "/callback/google",
          method: "GET",
          params: { id: "google" },
          body: undefined,
          query: { code: input.code!, state: input.state! },
          asResponse: true,
        });
        const location = result.headers.get("location");
        if (
          !scope.checked ||
          result.status !== 302 ||
          !location ||
          new URL(location).searchParams.get("error") !==
            "unable_to_create_session"
        )
          throw new APIError("UNAUTHORIZED", {
            message: "Google authentication failed",
          });
        ctx.setHeader("cache-control", "no-store");
        if (scope.pending) {
          const cookie = ctx.context.createAuthCookie("social_pre_auth", {
            maxAge: SOCIAL_PRE_AUTH_LIFETIME_MS / 1000,
          });
          ctx.setCookie(cookie.name, scope.pending.token, cookie.attributes);
          return ctx.json({ secondFactorRequired: true });
        }
        if (!scope.issued) throw new Error("Missing session result");
        // Only a session minted after a locked no-factor decision is released.
        await setSessionCookie(ctx, scope.issued);
        ctx.setHeader(
          "location",
          new URL("/auth/google/complete", ctx.context.baseURL).href,
        );
        return new Response(null, {
          status: 302,
          headers: ctx.responseHeaders,
        });
      });
    } catch (error) {
      // Never leave an undisclosed no-factor session after failed response assembly.
      // The 2FA branch NEVER inserts a session, so it needs no delayed cleanup.
      if (scope.issued) {
        try {
          await this.database.db
            .delete(session)
            .where(eq(session.id, scope.issued.session.id));
        } catch {
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Google authentication unavailable",
          });
        }
      }
      if (isAPIError(error))
        throw new APIError(error.status, {
          message: "Google authentication failed",
        });
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Google authentication unavailable",
      });
    }
  }
}
export function googlePreAuthPlugin(bridge: GooglePreAuth) {
  return {
    id: "google-pre-auth",
    endpoints: {
      // Same core keys replace public routes with server-only controlled entry points.
      signInSocial: createAuthEndpoint.serverOnly(
        { method: "POST", requireHeaders: true, body: googleBody(false) },
        (ctx) => bridge.begin(ctx),
      ),
      callbackOAuth: createAuthEndpoint.serverOnly(
        { method: "POST", requireHeaders: true, body: googleBody(true) },
        (ctx) => bridge.callback(ctx),
      ),
    },
  };
}
