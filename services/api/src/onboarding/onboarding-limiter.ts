import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_USERS = 10000;
// Per-process sliding window. Never evict live limits to admit new identities.
@Injectable()
export class OnboardingLimiter {
  private readonly attempts = new Map<string, number[]>();
  consume(userId: string, now = Date.now()): void {
    const recent = (this.attempts.get(userId) ?? []).filter(
      (t) => t > now - WINDOW_MS,
    );
    if (!this.attempts.has(userId) && this.attempts.size >= MAX_USERS) {
      for (const [id, times] of this.attempts) {
        if (times.at(-1)! <= now - WINDOW_MS) this.attempts.delete(id);
      }
      if (this.attempts.size >= MAX_USERS) this.deny();
    }
    if (recent.length >= MAX_ATTEMPTS) this.deny();
    this.attempts.set(userId, [...recent, now]);
  }
  private deny(): never {
    throw new HttpException(
      "Onboarding rate limit exceeded",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
