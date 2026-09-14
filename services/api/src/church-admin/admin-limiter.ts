import { HttpException, Injectable } from "@nestjs/common";
// Per-user, per-process sliding minute; bounded cardinality, no live-entry eviction.
@Injectable()
export class AdminMutationLimiter {
  private readonly attempts = new Map<string, number[]>();
  consume(userId: string, now = Date.now()) {
    const recent = (this.attempts.get(userId) ?? []).filter(
      (t) => t > now - 60000,
    );
    if (!this.attempts.has(userId) && this.attempts.size >= 10000) {
      for (const [id, times] of this.attempts)
        if (times.at(-1)! <= now - 60000) this.attempts.delete(id);
      if (this.attempts.size >= 10000) this.deny();
    }
    if (recent.length >= 20) this.deny();
    this.attempts.set(userId, [...recent, now]);
  }
  private deny(): never {
    throw new HttpException("Administration rate limit exceeded", 429);
  }
}
