import { Logger } from "@nestjs/common";
import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import type { AuthEmailSender } from "./auth-email.js";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_RESET_EXPIRES_IN = 3600;

const fields: Record<string, readonly string[]> = {
  "/change-password": ["currentPassword", "newPassword", "revokeOtherSessions"],
  "/request-password-reset": ["email", "redirectTo"],
  "/reset-password": ["newPassword", "token"],
};

export function enforcePasswordRequest(ctx: GenericEndpointContext) {
  const allowed = fields[ctx.path];
  if (!allowed) return;
  const body: unknown = ctx.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "UNSUPPORTED_PASSWORD_FIELDS",
      message: "Password request contains unsupported fields",
    });
  }
  if (ctx.path === "/change-password") {
    if (
      "revokeOtherSessions" in body &&
      typeof body.revokeOtherSessions !== "boolean"
    ) {
      throw new APIError("BAD_REQUEST", {
        code: "INVALID_REVOCATION_OPTION",
        message: "Invalid revocation option",
      });
    }
    if (
      "currentPassword" in body &&
      "newPassword" in body &&
      typeof body.currentPassword === "string" &&
      typeof body.newPassword === "string" &&
      body.currentPassword.normalize("NFKC") ===
        body.newPassword.normalize("NFKC")
    ) {
      // Compare only supplied values; Better Auth still verifies the actual hash.
      throw new APIError("BAD_REQUEST", {
        code: "PASSWORD_MUST_DIFFER",
        message: "New password must differ from current password",
      });
    }
    // Native true deletes A and creates a replacement with a new createdAt.
    // Keep A here; the success hook below mandates deletion of B/C instead.
    return {
      context: { ...ctx, body: { ...body, revokeOtherSessions: false } },
    };
  }
}

export async function completePasswordChange(
  ctx: GenericEndpointContext,
  emailSender: AuthEmailSender,
) {
  if (ctx.path !== "/change-password") return;
  const current = ctx.context.session;
  if (!current) throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
  try {
    const sessions = await ctx.context.internalAdapter.listSessions(
      current.user.id,
    );
    for (const session of sessions) {
      if (session.id !== current.session.id)
        await ctx.context.internalAdapter.deleteSession(session.token);
    }
    if (
      (await ctx.context.internalAdapter.listSessions(current.user.id)).some(
        (session) => session.id !== current.session.id,
      )
    ) {
      throw new Error("Session revocation incomplete");
    }
  } catch {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "PASSWORD_SESSION_REVOCATION_FAILED",
      message: "Password operation could not be completed",
    });
  }
  new Logger("AuthModule").log({
    event: "password_changed",
    userId: current.user.id,
    sessionId: current.session.id,
    outcome: "other_sessions_revoked",
  });
  emailSender.dispatchPasswordChanged({
    recipient: current.user.email,
    reason: "change",
  });
}
