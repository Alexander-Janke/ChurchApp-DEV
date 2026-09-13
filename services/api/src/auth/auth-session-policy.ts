export const WEB_SESSION_EXPIRES_IN = 7 * 24 * 60 * 60;
export const WEB_SESSION_UPDATE_AGE = 24 * 60 * 60;
export const WEB_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

// One application-owned clock boundary; clients cannot select a longer policy.
export class AuthSessionPolicy {
  constructor(private readonly now: () => number = () => Date.now()) {}

  isExpired(session: { createdAt: Date; expiresAt: Date }): boolean {
    const now = this.now();
    const created = new Date(session.createdAt).getTime();
    const expires = new Date(session.expiresAt).getTime();
    return (
      !Number.isFinite(created) ||
      !Number.isFinite(expires) ||
      created > now ||
      created + WEB_SESSION_ABSOLUTE_MS <= now ||
      expires <= now
    );
  }
}
