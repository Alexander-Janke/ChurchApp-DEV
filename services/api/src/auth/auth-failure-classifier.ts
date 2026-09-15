import type { AuthSecurityEventInput } from "./auth-security-event-policy.js";

export const AUTH_FAILURE_THRESHOLD = 5;
export const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const AUTH_FAILURE_CLASSIFIER_CAPACITY = 10_000;

export type AuthenticationFailureFlow =
  "password" | "totp" | "recovery" | "google";
export type AuthenticationFailureMethod = "password" | "totp" | "recovery";

type Bucket = {
  failures: number[];
  suppressedUntil: number;
};

export type AuthenticationFailureObservation = {
  flow: AuthenticationFailureFlow;
  method: AuthenticationFailureMethod;
  target: string;
  subjectUserId: string | null;
};

export type AuthenticationFailureWriter = (
  input: Extract<
    AuthSecurityEventInput,
    { eventType: "authentication_failure" }
  >,
) => Promise<void>;

export function subjectFailureTarget(userId: string): string {
  return `user:${userId}`;
}

export function credentialFailureTarget(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    !normalized.includes("@")
  )
    return null;
  return `login:${normalized}`;
}

/**
 * Classifies only conclusive proof failures. Counters are intentionally
 * transient; the durable authentication event is the security record.
 */
export class AuthenticationFailureClassifier {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly write: AuthenticationFailureWriter,
    private readonly now = () => Date.now(),
  ) {}

  async observe(input: AuthenticationFailureObservation): Promise<void> {
    const now = this.now();
    const target = input.target.trim();
    if (!target || target.length > 512) return;
    const key = `${input.flow}:${target}`;
    const bucket = this.getBucket(key, now);
    if (!bucket) return;

    bucket.failures = bucket.failures.filter(
      (timestamp) =>
        timestamp <= now && now - timestamp < AUTH_FAILURE_WINDOW_MS,
    );
    if (bucket.suppressedUntil > now) return;

    bucket.failures.push(now);
    if (bucket.failures.length < AUTH_FAILURE_THRESHOLD) return;

    // Start the suppression window before awaiting persistence. This keeps
    // concurrent failures in this process from producing duplicate events.
    bucket.failures = [];
    bucket.suppressedUntil = now + AUTH_FAILURE_WINDOW_MS;
    try {
      await this.write({
        eventType: "authentication_failure",
        // A failed proof has no authenticated actor. Keep the resolved target
        // only as the historical subject; unattributed targets remain null.
        actorUserId: null,
        subjectUserId: input.subjectUserId,
        sessionId: null,
        metadata: { method: input.method, category: "repeated" },
      });
    } catch {
      // Authentication has already failed. Audit persistence failure must not
      // turn that denial into success or expose storage details to the caller.
    }
  }

  reset(flow: AuthenticationFailureFlow, targets: readonly string[]): void {
    for (const target of targets) {
      const normalized = target.trim();
      if (normalized) this.buckets.delete(`${flow}:${normalized}`);
    }
  }

  get size(): number {
    return this.buckets.size;
  }

  private getBucket(key: string, now: number): Bucket | null {
    this.prune(now);
    let bucket = this.buckets.get(key);
    if (bucket) return bucket;
    if (this.buckets.size >= AUTH_FAILURE_CLASSIFIER_CAPACITY) return null;
    bucket = { failures: [], suppressedUntil: 0 };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      const active = bucket.failures.some(
        (timestamp) =>
          timestamp <= now && now - timestamp < AUTH_FAILURE_WINDOW_MS,
      );
      if (!active && bucket.suppressedUntil <= now) this.buckets.delete(key);
    }
  }
}
