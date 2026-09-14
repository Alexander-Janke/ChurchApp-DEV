import "reflect-metadata";
import { expect, it, vi } from "vitest";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { AppModule } from "../src/app.module.js";
import { OnboardingModule } from "../src/onboarding/onboarding.module.js";
import {
  ChurchOnboardingService,
  OnboardingDeniedError,
} from "../src/onboarding/church-onboarding.service.js";
import { parseChurchDetails } from "../src/church/church-policy.js";
import { STANDARD_ROLES } from "../src/authorization/standard-roles.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { TenantDatabase } from "../src/database/tenant-database.js";
import type { ChurchRepository } from "../src/church/church.repository.js";
import type { MembershipRepository } from "../src/membership/membership.repository.js";
import type { OwnershipService } from "../src/ownership/ownership.service.js";
import type { StandardRoleService } from "../src/authorization/standard-role.service.js";

it("onboarding module has no HTTP controllers and is not mounted", () => {
  expect(
    Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OnboardingModule) ?? [],
  ).toEqual([]);
  expect(
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? []).includes(
      OnboardingModule,
    ),
  ).toBe(false);
  expect(
    Reflect.getMetadata(MODULE_METADATA.EXPORTS, OnboardingModule),
  ).toEqual([ChurchOnboardingService]);
});
it.each([
  "id",
  "status",
  "verificationState",
  "owner",
  "ownerMembershipId",
  "primaryOwner",
  "isPrimaryOwner",
  "roles",
  "permissions",
  "creatorUserId",
  "ownerUserId",
  "primaryOwnerUserId",
  "sessionId",
])("existing church policy rejects onboarding protected field %s", (field) => {
  expect(() =>
    parseChurchDetails({ name: "Church", slug: "church", [field]: "injected" }),
  ).toThrow("Invalid church details");
});
it.each([
  { name: " " },
  { slug: "bad slug" },
  { addressLine1: "x".repeat(201) },
  { countryCode: "de" },
  { denomination: "x".repeat(121) },
  { logo: "javascript:alert(1)" },
  { logo: "https://user:password@example.invalid/logo" },
])("reuses invalid church-field rejection %#", (invalid) => {
  expect(() =>
    parseChurchDetails({ name: "Church", slug: "church", ...invalid }),
  ).toThrow("Invalid church details");
});
it("uses existing canonical slug/name/address normalization", () => {
  expect(
    parseChurchDetails({
      name: "  Unicode Église  ",
      slug: "New-Church",
      addressLine1: " Street ",
    }),
  ).toMatchObject({
    name: "Unicode Église",
    slug: "new-church",
    addressLine1: "Street",
    countryCode: null,
  });
});
it("canonical roles remain exactly four nonprivileged empty system bundles", () => {
  expect(STANDARD_ROLES.map((r) => r.key)).toEqual([
    "group_leader",
    "area_leader",
    "event_administrator",
    "childrens_worker",
  ]);
  for (const role of STANDARD_ROLES)
    expect(role).toMatchObject({
      isSystem: true,
      privileged: false,
      permissions: [],
    });
});
it("denied creator aborts before tenant bootstrap or writes without leaking claims", async () => {
  const tx = { execute: vi.fn().mockResolvedValue({}) };
  const database = {
    transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(tx)),
  };
  const tenants = { inTransaction: vi.fn() };
  const owner = {
    eligibleInitialCreatorInTransaction: vi.fn().mockResolvedValue(false),
  };
  const service = new ChurchOnboardingService(
    database as unknown as DatabaseService,
    tenants as unknown as TenantDatabase,
    {} as ChurchRepository,
    {} as MembershipRepository,
    owner as unknown as OwnershipService,
    {} as StandardRoleService,
  );
  await expect(
    service.createChurch(
      { userId: "creator", sessionId: "session" },
      { name: "Church", slug: "church" },
    ),
  ).rejects.toThrow(OnboardingDeniedError);
  expect(tenants.inTransaction).not.toHaveBeenCalled();
});
it("caller identity claims in subject are rejected before opening a transaction", async () => {
  const database = { transaction: vi.fn() };
  const service = new ChurchOnboardingService(
    database as unknown as DatabaseService,
    {} as TenantDatabase,
    {} as ChurchRepository,
    {} as MembershipRepository,
    {} as OwnershipService,
    {} as StandardRoleService,
  );
  const subject = { userId: "creator", sessionId: "session", elevated: true };
  await expect(
    service.createChurch(subject, { name: "Church", slug: "church" }),
  ).rejects.toThrow("Server-resolved ownership actor required");
  expect(database.transaction).not.toHaveBeenCalled();
});
