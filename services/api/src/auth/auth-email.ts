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

export interface EmailChangeApprovalMessage extends EmailVerificationMessage {
  readonly newEmail: string;
}
export interface EmailChangeVerificationMessage extends EmailVerificationMessage {}
export interface EmailChangeCompletedMessage {
  readonly recipient: string;
  readonly newEmail: string;
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

  async sendEmailChangeApproval(
    _message: EmailChangeApprovalMessage,
  ): Promise<void> {
    throw new AuthEmailUnavailableError();
  }
  async sendEmailChangeVerification(
    _message: EmailChangeVerificationMessage,
  ): Promise<void> {
    throw new AuthEmailUnavailableError();
  }
  async sendEmailChangeCompleted(
    _message: EmailChangeCompletedMessage,
  ): Promise<void> {
    throw new AuthEmailUnavailableError();
  }
  deliverEmailChangeApproval(
    message: EmailChangeApprovalMessage,
  ): Promise<void> {
    return this.requiredDelivery(() => this.sendEmailChangeApproval(message));
  }
  deliverEmailChangeVerification(
    message: EmailChangeVerificationMessage,
  ): Promise<void> {
    return this.requiredDelivery(() =>
      this.sendEmailChangeVerification(message),
    );
  }
  dispatchEmailChangeCompleted(message: EmailChangeCompletedMessage): void {
    try {
      this.dispatch(() => this.sendEmailChangeCompleted(message));
    } catch {
      this.logger.error("Authentication email delivery failed");
    }
  }
  private async requiredDelivery(send: () => Promise<void>): Promise<void> {
    this.assertAvailable();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delivery = Promise.resolve().then(send);
    // Track late completion even after timeout. A late email carries an invalid
    // token if its transaction rolled back; provider diagnostics never escape.
    const pending = delivery
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => this.pending.delete(pending));
    this.pending.add(pending);
    try {
      await Promise.race([
        delivery,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Email delivery timed out")),
            5000,
          );
        }),
      ]);
    } catch {
      this.logger.error("Authentication email delivery failed");
      throw new Error("Authentication email delivery failed");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
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
