import { BadRequestException, type PipeTransform } from "@nestjs/common";
import {
  parseChurchDetails,
  type ChurchDetails,
} from "../church/church-policy.js";
import type { ChurchOnboardingService } from "./church-onboarding.service.js";

// Validation stays in the canonical church policy; this pipe only maps transport errors.
export class OnboardingInputPipe implements PipeTransform<
  unknown,
  ChurchDetails
> {
  transform(input: unknown): ChurchDetails {
    try {
      return parseChurchDetails(input);
    } catch {
      throw new BadRequestException("Invalid church details");
    }
  }
}
export interface OnboardingResponse {
  church: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
    verificationState:
      "unverified" | "pending" | "verified" | "rejected" | "revoked";
  };
  membership: {
    id: string;
    status: "follower" | "member" | "inactive" | "left";
  };
  ownership: { isPrimaryOwner: true };
}
export function mapOnboardingResponse(
  result: Awaited<ReturnType<ChurchOnboardingService["createChurch"]>>,
): OnboardingResponse {
  return {
    church: {
      id: result.church.id,
      name: result.church.name,
      slug: result.church.slug,
      status: result.church.status,
      verificationState: result.church.verificationState,
    },
    membership: { id: result.membership.id, status: result.membership.status },
    ownership: { isPrimaryOwner: result.ownership.isPrimaryOwner },
  };
}
