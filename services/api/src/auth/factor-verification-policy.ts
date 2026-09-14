import type { GenericEndpointContext } from "better-auth";
import { APIError, getSessionFromCtx } from "better-auth/api";

export type FactorMethod = "totp" | "recovery";
export function factorCode(body: unknown, method: FactorMethod): string {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("code" in body) ||
    typeof body.code !== "string" ||
    !(
      method === "totp" ? /^[0-9]{6}$/ : /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/
    ).test(body.code)
  )
    throw new APIError("BAD_REQUEST", { message: "Invalid factor request" });
  return body.code;
}
export function requireFactorOrigin(ctx: GenericEndpointContext) {
  if (ctx.headers?.get("origin") !== new URL(ctx.context.baseURL).origin)
    throw new APIError("FORBIDDEN", { message: "Untrusted request origin" });
}
export async function enforceFactorLogin(ctx: GenericEndpointContext) {
  const method =
    ctx.path === "/two-factor/verify-totp"
      ? "totp"
      : ctx.path === "/two-factor/verify-backup-code"
        ? "recovery"
        : null;
  if (!method) return;
  requireFactorOrigin(ctx);
  factorCode(ctx.body, method);
  // Native verify also accepts active sessions and can confirm enrollment.
  // That mode must never bypass the generation-bound enrollment coordinator.
  if (await getSessionFromCtx(ctx))
    throw new APIError("CONFLICT", {
      message: "A pending sign-in challenge is required",
    });
  const key = await ctx.getSignedCookie(
    ctx.context.createAuthCookie("two_factor").name,
    ctx.context.secret,
  );
  const challenge = key
    ? await ctx.context.internalAdapter.findVerificationValue(key)
    : null;
  if (!challenge || challenge.expiresAt.getTime() <= Date.now())
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid sign-in challenge",
    });
  const owner = await ctx.context.internalAdapter.findUserById(challenge.value);
  const factor = await ctx.context.adapter.findOne<{ verified: boolean }>({
    model: "twoFactor",
    where: [{ field: "userId", value: challenge.value }],
  });
  if (
    !owner ||
    !("twoFactorEnabled" in owner) ||
    owner.twoFactorEnabled !== true ||
    factor?.verified !== true
  )
    throw new APIError("UNAUTHORIZED", {
      message: "Invalid sign-in challenge",
    });
}

// Standard Schema interface keeps server-only endpoint typing and strict input
// validation without adding a runtime validation dependency.
export function factorBody(method: FactorMethod) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "church-platform",
      validate(value: unknown) {
        try {
          return { value: { code: factorCode(value, method) } };
        } catch {
          return { issues: [{ message: "Invalid factor request" }] };
        }
      },
    },
  };
}
