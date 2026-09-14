import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { UpdateSelfProfileRequest } from "@church-platform/contracts";
import { ProfileRepository } from "./profile.repository.js";
function usernameConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  return (
    (e.code === "23505" && e.constraint === "user_profile_username_idx") ||
    (e.cause !== undefined && e.cause !== error && usernameConflict(e.cause))
  );
}
@Injectable()
export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (usernameConflict(error))
        throw new ConflictException("Username is unavailable");
      throw new ServiceUnavailableException("Profile operation unavailable");
    }
  }
  read(userId: string) {
    return this.safe(() => this.repository.read(userId));
  }
  update(userId: string, patch: UpdateSelfProfileRequest) {
    return this.safe(() => this.repository.update(userId, patch));
  }
}
