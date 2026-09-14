import {
  AuthEmailSender,
  type EmailVerificationMessage,
  type EmailChangeApprovalMessage,
  type EmailChangeVerificationMessage,
  type EmailChangeCompletedMessage,
  type PasswordResetMessage,
  type PasswordChangedMessage,
} from "../../src/auth/auth-email.js";

// Test-only capture: never exported by an application module or selected by env.
export class TestAuthEmailSender extends AuthEmailSender {
  readonly mode = "test" as const;
  readonly emailChangeApprovals: EmailChangeApprovalMessage[] = [];
  readonly emailChangeVerifications: EmailChangeVerificationMessage[] = [];
  readonly emailChangeCompletions: EmailChangeCompletedMessage[] = [];
  async sendEmailChangeApproval(message: EmailChangeApprovalMessage) {
    this.assertAvailable();
    this.emailChangeApprovals.push({ ...message });
  }
  async sendEmailChangeVerification(message: EmailChangeVerificationMessage) {
    this.assertAvailable();
    this.emailChangeVerifications.push({ ...message });
  }
  async sendEmailChangeCompleted(message: EmailChangeCompletedMessage) {
    this.assertAvailable();
    this.emailChangeCompletions.push({ ...message });
  }
  readonly messages: EmailVerificationMessage[] = [];
  readonly passwordResets: PasswordResetMessage[] = [];
  readonly passwordChanges: PasswordChangedMessage[] = [];

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
    this.emailChangeApprovals.length = 0;
    this.emailChangeVerifications.length = 0;
    this.emailChangeCompletions.length = 0;
    this.messages.length = 0;
    this.passwordResets.length = 0;
    this.passwordChanges.length = 0;
  }

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    this.assertAvailable();
    this.passwordResets.push({ ...message });
  }
  async sendPasswordChanged(message: PasswordChangedMessage): Promise<void> {
    this.assertAvailable();
    this.passwordChanges.push({ ...message });
  }
}
