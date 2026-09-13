import { Module } from "@nestjs/common";

export interface EmailVerificationMessage {
  readonly recipient: string;
  readonly url: string;
  readonly token: string;
}

export class AuthEmailUnavailableError extends Error {
  constructor() {
    super("Authentication email delivery is not configured");
    this.name = "AuthEmailUnavailableError";
  }
}

export abstract class AuthEmailSender {
  abstract readonly mode: "unavailable" | "test" | "production";
  abstract assertAvailable(): void;
  abstract sendEmailVerification(
    message: EmailVerificationMessage,
  ): Promise<void>;
}

export class UnavailableAuthEmailSender extends AuthEmailSender {
  readonly mode = "unavailable" as const;

  assertAvailable(): never {
    throw new AuthEmailUnavailableError();
  }

  async sendEmailVerification(): Promise<never> {
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
