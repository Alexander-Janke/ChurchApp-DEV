import { APIError } from "better-auth/api";
import { challengeKey } from "./google-pre-auth-policy.js";
import { factorCode, type FactorMethod } from "./factor-verification-policy.js";

export function googleCompletionInput(
  value: unknown,
  method: FactorMethod,
  cookie?: string | null,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length < 1 ||
    Object.keys(value).length > 2 ||
    Object.keys(value).some((key) => !["challenge", "code"].includes(key))
  )
    throw new APIError("BAD_REQUEST", {
      message: "Invalid completion request",
    });
  const body = value as Record<string, unknown>;
  const challenge = body.challenge ?? cookie;
  if (
    typeof challenge !== "string" ||
    !/^[a-f0-9]{64}$/.test(challenge) ||
    (cookie && "challenge" in body && body.challenge !== cookie)
  )
    throw new APIError("BAD_REQUEST", {
      message: "Invalid completion request",
    });
  return {
    challenge,
    code: factorCode({ code: body.code }, method),
  };
}

// Bounded single-instance sliding-minute limiter; no active-entry eviction.
// Native durable challenge/account budgets provide protection across instances.
export class GoogleCompletionLimiter {
  private readonly attempts = new Map<string, number[]>();
  consume(credential: string, now = Date.now()) {
    const key = challengeKey(credential);
    const recent = (this.attempts.get(key) ?? []).filter(
      (t) => t > now - 60000,
    );
    if (!this.attempts.has(key) && this.attempts.size >= 10000) {
      for (const [id, times] of this.attempts)
        if (times.at(-1)! <= now - 60000) this.attempts.delete(id);
      if (this.attempts.size >= 10000) this.deny();
    }
    if (recent.length >= 5) this.deny();
    this.attempts.set(key, [...recent, now]);
  }
  private deny(): never {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Factor attempts limited",
    });
  }
}
