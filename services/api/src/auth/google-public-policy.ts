export const GOOGLE_PUBLIC_INITIATION_LIMIT = 10;
export const GOOGLE_PUBLIC_CALLBACK_LIMIT = 20;
export const GOOGLE_PUBLIC_LIMIT_WINDOW_MS = 60_000;
export const GOOGLE_PUBLIC_LIMITER_CAPACITY = 10_000;

export class GooglePublicRateLimitError extends Error {
  constructor() {
    super("Google authentication is busy");
    this.name = "GooglePublicRateLimitError";
  }
}

type Kind = "initiation" | "callback";

/**
 * Bounded single-instance source throttling. The key is derived from the
 * connected socket, never from a caller-supplied user/provider identifier.
 * A restart resets the budget; distributed enforcement is deferred.
 */
export class GooglePublicLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(private readonly now = () => Date.now()) {}

  consume(kind: Kind, key: string, now = this.now()): void {
    const bucketKey = `${kind}:${key}`;
    if (!key) throw new GooglePublicRateLimitError();
    if (
      !this.buckets.has(bucketKey) &&
      this.buckets.size >= GOOGLE_PUBLIC_LIMITER_CAPACITY
    ) {
      const cutoff = now - GOOGLE_PUBLIC_LIMIT_WINDOW_MS;
      for (const [activeKey, timestamps] of this.buckets) {
        if (!timestamps.some((timestamp) => timestamp > cutoff))
          this.buckets.delete(activeKey);
      }
    }
    if (
      !this.buckets.has(bucketKey) &&
      this.buckets.size >= GOOGLE_PUBLIC_LIMITER_CAPACITY
    )
      throw new GooglePublicRateLimitError();
    const cutoff = now - GOOGLE_PUBLIC_LIMIT_WINDOW_MS;
    const current = (this.buckets.get(bucketKey) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
    const limit =
      kind === "initiation"
        ? GOOGLE_PUBLIC_INITIATION_LIMIT
        : GOOGLE_PUBLIC_CALLBACK_LIMIT;
    if (current.length >= limit) {
      this.buckets.set(bucketKey, current);
      throw new GooglePublicRateLimitError();
    }
    current.push(now);
    this.buckets.set(bucketKey, current);
  }

  get size(): number {
    return this.buckets.size;
  }
}
