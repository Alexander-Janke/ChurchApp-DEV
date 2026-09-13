import { Logger, Module } from "@nestjs/common";

export interface EmailVerificationMessage {
  readonly recipient: string;
  readonly url: string;
  readonly token: string;
}

export interface PasswordResetMessage {
  readonly recipient: string;
  readonly url: string;
  readonly token: string;
}

export interface PasswordChangedMessage {
  readonly recipient: string;
  readonly reason: "change" | "reset";
}

export class AuthEmailUnavailableError extends Error {
  constructor() {
    super("Authentication email delivery is not configured");
    this.name = "AuthEmailUnavailableError";
  }
}

export abstract class AuthEmailSender {
  private readonly pending = new Set<Promise<void>>();
  private readonly logger = new Logger("AuthEmailSender");
  abstract readonly mode: "unavailable" | "test" | "production";
  abstract assertAvailable(): void;
  abstract sendEmailVerification(
    message: EmailVerificationMessage,
  ): Promise<void>;
  abstract sendPasswordReset(message: PasswordResetMessage): Promise<void>;
  abstract sendPasswordChanged(message: PasswordChangedMessage): Promise<void>;

  dispatchPasswordReset(message: PasswordResetMessage): void {
    this.dispatch(() => this.sendPasswordReset(message));
  }

  dispatchPasswordChanged(message: PasswordChangedMessage): void {
    this.dispatch(() => this.sendPasswordChanged(message));
  }

  private dispatch(send: () => Promise<void>): void {
    this.assertAvailable();
    const pending = Promise.resolve()
      .then(send)
      .catch(() => {
        // Never forward provider errors, recipients, tokens or URLs.
        this.logger.error("Authentication email delivery failed");
      })
      .finally(() => this.pending.delete(pending));
    this.pending.add(pending);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.pending);
  }
}

export class UnavailableAuthEmailSender extends AuthEmailSender {
  readonly mode = "unavailable" as const;

  assertAvailable(): never {
    throw new AuthEmailUnavailableError();
  }

  async sendEmailVerification(): Promise<never> {
    throw new AuthEmailUnavailableError();
  }
  async sendPasswordReset(): Promise<never> {
    throw new AuthEmailUnavailableError();
  }
  async sendPasswordChanged(): Promise<never> {
    throw new AuthEmailUnavailableError();
  }
}

@Module({
  providers: [
    { provide: AuthEmailSender, useClass: UnavailableAuthEmailSender },
  ],
  exports: [AuthEmailSender],
})
export class AuthEmailModule {}
