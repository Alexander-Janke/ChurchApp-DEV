export const HEALTH_RESPONSE = { status: "ok" } as const;

export type HealthResponse = typeof HEALTH_RESPONSE;
export type {
  SelfProfile,
  ProfileAddress,
  UpdateSelfProfileRequest,
} from "./profile.js";
