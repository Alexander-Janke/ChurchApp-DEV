export interface ProfileAddress {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  locality: string | null;
  region: string | null;
  countryCode: string | null;
}
export interface SelfProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  address: ProfileAddress | null;
  biography: string | null;
  identityCreatedAt: string;
  profileCreatedAt: string | null;
  profileUpdatedAt: string | null;
}
export interface UpdateSelfProfileRequest {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  phoneNumber?: string | null;
  address?: Partial<ProfileAddress> | null;
  biography?: string | null;
  image?: string | null;
}
