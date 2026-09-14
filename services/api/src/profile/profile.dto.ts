import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import type {
  ProfileAddress,
  UpdateSelfProfileRequest,
} from "@church-platform/contracts";

const fields = [
  "username",
  "firstName",
  "lastName",
  "dateOfBirth",
  "phoneNumber",
  "address",
  "biography",
  "image",
];
function invalid(): never {
  throw new BadRequestException("Invalid profile update");
}
function object(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (Object.keys(value).some((k) => !allowed.includes(k))) invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number, trim = true): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.includes("\u0000")) invalid();
  const result = trim ? value.trim() : value;
  if ((trim && result.length === 0) || Array.from(result).length > max)
    invalid();
  return result;
}
export function parseProfilePatch(
  value: unknown,
  today = new Date().toISOString().slice(0, 10),
): UpdateSelfProfileRequest {
  const body = object(value, fields);
  if (Object.keys(body).length === 0) invalid();
  const patch: UpdateSelfProfileRequest = {};
  if ("username" in body) {
    const v = string(body.username, 30, false);
    if (v !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,28}[a-zA-Z0-9]$/.test(v))
      invalid();
    patch.username = v?.toLowerCase() ?? null;
  }
  if ("firstName" in body) patch.firstName = string(body.firstName, 100);
  if ("lastName" in body) patch.lastName = string(body.lastName, 100);
  if ("dateOfBirth" in body) {
    const v = string(body.dateOfBirth, 10, false);
    if (
      v !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        v < "0001-01-01" ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v ||
        v > today)
    )
      invalid();
    patch.dateOfBirth = v;
  }
  if ("phoneNumber" in body) {
    const v = string(body.phoneNumber, 16, false);
    if (v !== null && !/^\+[1-9][0-9]{7,14}$/.test(v)) invalid();
    patch.phoneNumber = v;
  }
  if ("biography" in body)
    patch.biography = string(body.biography, 2000, false);
  if ("image" in body) {
    const v = string(body.image, 2048, false);
    if (v !== null) {
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        invalid();
      }
      if (
        v !== v.trim() ||
        !v.startsWith("https://") ||
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password
      )
        invalid();
    }
    patch.image = v;
  }
  if ("address" in body) {
    if (body.address === null) patch.address = null;
    else {
      const a = object(body.address, [
        "line1",
        "line2",
        "postalCode",
        "locality",
        "region",
        "countryCode",
      ]);
      const address: ProfileAddress = {
        line1: "line1" in a ? string(a.line1, 200) : null,
        line2: "line2" in a ? string(a.line2, 200) : null,
        postalCode: "postalCode" in a ? string(a.postalCode, 32) : null,
        locality: "locality" in a ? string(a.locality, 120) : null,
        region: "region" in a ? string(a.region, 120) : null,
        countryCode:
          "countryCode" in a ? string(a.countryCode, 2, false) : null,
      };
      if (
        address.countryCode !== null &&
        !/^[A-Z]{2}$/.test(address.countryCode)
      )
        invalid();
      patch.address = address;
    }
  }
  return patch;
}
@Injectable()
export class ProfilePatchPipe implements PipeTransform<
  unknown,
  UpdateSelfProfileRequest
> {
  transform(value: unknown): UpdateSelfProfileRequest {
    return parseProfilePatch(value);
  }
}
