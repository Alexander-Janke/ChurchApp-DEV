import { AuthSessionPolicy } from "./auth-session-policy.js";

// Deliberately code-owned: no environment/configuration switch or HTTP issuer.
export const SECURE_ELEVATION_COMPLETION_ENABLED = false;
export const ELEVATION_IDLE_MS = 15 * 60 * 1000;
export const ELEVATION_MAX_MS = 8 * 60 * 60 * 1000;
export const STEP_UP_MAX_MS = 5 * 60 * 1000;
export interface AssuranceState {
  elevatedAt: Date | null;
  lastElevatedActivityAt: Date | null;
  stepUpAt: Date | null;
}
export interface AssuranceResult {
  authenticated: boolean;
  elevated: boolean;
  recentStepUp: boolean;
}
export const NO_ASSURANCE: Readonly<AssuranceResult> = Object.freeze({
  authenticated: false,
  elevated: false,
  recentStepUp: false,
});

export class AssurancePolicy {
  constructor(readonly now: () => number = () => Date.now()) {}
  evaluate(
    session: { createdAt: Date; expiresAt: Date } | null,
    state: AssuranceState | null,
  ): AssuranceResult {
    const now = this.now();
    if (
      !Number.isFinite(now) ||
      !session ||
      new AuthSessionPolicy(() => now).isExpired(session)
    )
      return { ...NO_ASSURANCE };
    const start = session.createdAt.getTime();
    const timestamp = (date: Date | null | undefined) => {
      const value = date instanceof Date ? date.getTime() : NaN;
      return Number.isFinite(value) && value >= start && value <= now
        ? value
        : NaN;
    };
    const elevated = timestamp(state?.elevatedAt);
    const activity = timestamp(state?.lastElevatedActivityAt);
    const step = timestamp(state?.stepUpAt);
    return {
      authenticated: true,
      elevated:
        activity >= elevated &&
        now < activity + ELEVATION_IDLE_MS &&
        now < elevated + ELEVATION_MAX_MS,
      recentStepUp: now < step + STEP_UP_MAX_MS,
    };
  }
}

// No claim, proof payload or caller timestamp can issue assurance in Task 1.15.
export function requireSecureElevationCompletion(): never {
  throw new Error(
    "Secure assurance completion is unavailable pending Task 1.7b",
  );
}
