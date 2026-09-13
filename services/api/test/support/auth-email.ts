import {
  AuthEmailSender,
  type EmailVerificationMessage,
} from "../../src/auth/auth-email.js";

// Test-only capture: never exported by an application module or selected by env.
export class TestAuthEmailSender extends AuthEmailSender {
  readonly mode = "test" as const;
  readonly messages: EmailVerificationMessage[] = [];

  constructor() {
    super();
    this.assertAvailable();
  }

  assertAvailable(): void {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Auth email capture is restricted to test processes");
    }
  }

  async sendEmailVerification(
    message: EmailVerificationMessage,
  ): Promise<void> {
    this.assertAvailable();
    this.messages.push({ ...message });
  }

  reset(): void {
    this.messages.length = 0;
  }
}
