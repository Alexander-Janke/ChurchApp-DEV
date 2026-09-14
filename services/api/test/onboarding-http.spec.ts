import "reflect-metadata";
import { Test } from "@nestjs/testing";
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { configureApp } from "../src/configure-app.js";
import { AuthSessionReader } from "../src/auth/auth-session-reader.js";
import { OnboardingController } from "../src/onboarding/onboarding.controller.js";
import { OnboardingGuard } from "../src/onboarding/onboarding.guard.js";
import { OnboardingLimiter } from "../src/onboarding/onboarding-limiter.js";
import {
  ChurchOnboardingService,
  ChurchSlugConflictError,
  OnboardingDeniedError,
} from "../src/onboarding/church-onboarding.service.js";

describe("onboarding HTTP boundary", () => {
  const origin = "http://localhost:3001";
  const sessions = { resolve: vi.fn() },
    onboarding = { createChurch: vi.fn() };
  const limiter = { consume: vi.fn() };
  let app: NestExpressApplication;
  const safe = {
    church: {
      id: "church",
      name: "Church",
      slug: "church",
      status: "active",
      verificationState: "unverified",
    },
    membership: { id: "membership", status: "member" },
    ownership: { isPrimaryOwner: true },
  };
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_URL", origin);
    const module = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        OnboardingGuard,
        { provide: AuthSessionReader, useValue: sessions },
        { provide: OnboardingLimiter, useValue: limiter },
        { provide: ChurchOnboardingService, useValue: onboarding },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    sessions.resolve.mockResolvedValue({
      userId: "server-user",
      sessionId: "server-session",
      cookies: [],
    });
    onboarding.createChurch.mockResolvedValue(safe);
    const real = new OnboardingLimiter();
    limiter.consume.mockImplementation((id: string) => real.consume(id));
  });
  const post = (body: unknown = { name: "Church", slug: "church" }) =>
    request(app.getHttpServer())
      .post("/api/v1/churches")
      .set("Origin", origin)
      .send(body as object);
  it("returns 201/no-store and passes only server-resolved identity to the atomic service", async () => {
    const res = await post({ name: " Church ", slug: "CHURCH" }).expect(201);
    expect(res.body).toEqual(safe);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(onboarding.createChurch).toHaveBeenCalledWith(
      { userId: "server-user", sessionId: "server-session" },
      expect.objectContaining({ name: "Church", slug: "church" }),
    );
    expect(limiter.consume).toHaveBeenCalledWith("server-user");
  });
  it.each(["missing", "revoked", "expired"])(
    "rejects %s session before service execution",
    async () => {
      sessions.resolve.mockRejectedValue(new UnauthorizedException());
      const res = await post().expect(401);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(onboarding.createChurch).not.toHaveBeenCalled();
    },
  );
  it("maps session verification outage to sanitized 503", async () => {
    sessions.resolve.mockRejectedValue(
      new ServiceUnavailableException("Session verification unavailable"),
    );
    await post().expect(503);
    expect(onboarding.createChurch).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    "null",
    "https://attacker.invalid",
    origin + "/",
    "http://localhost:3001.attacker.invalid",
  ])("rejects missing or non-exact Origin %#", async (value) => {
    const r = request(app.getHttpServer()).post("/api/v1/churches");
    if (value) r.set("Origin", value);
    await r.send({ name: "Church", slug: "church" }).expect(403);
    expect(onboarding.createChurch).not.toHaveBeenCalled();
  });
  it.each([
    "id",
    "status",
    "verificationState",
    "creatorUserId",
    "ownerUserId",
    "ownerMembershipId",
    "primaryOwner",
    "isPrimaryOwner",
    "roles",
    "permissions",
    "membershipStatus",
    "twoFactorEnabled",
    "sessionId",
    "unknown",
  ])("rejects protected/unknown input %s", async (field) => {
    await post({ name: "Church", slug: "church", [field]: "injected" }).expect(
      400,
    );
    expect(onboarding.createChurch).not.toHaveBeenCalled();
  });
  it.each([
    { name: " " },
    { slug: "invalid slug" },
    { addressLine1: "x".repeat(201) },
    { address: {} },
    { countryCode: "de" },
    { denomination: "x".repeat(121) },
    { logo: "javascript:alert(1)" },
    { logo: "https://user:pass@example.invalid/x" },
  ])("maps canonical invalid church input %# to 400", async (invalid) => {
    await post({ name: "Church", slug: "church", ...invalid }).expect(400);
    expect(onboarding.createChurch).not.toHaveBeenCalled();
  });
  it("rejects query owner/tenant selectors", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/churches?ownerUserId=other")
      .set("Origin", origin)
      .send({ name: "Church", slug: "church" })
      .expect(400);
    expect(onboarding.createChurch).not.toHaveBeenCalled();
  });
  it.each([
    [new OnboardingDeniedError(), 403],
    [new ChurchSlugConflictError(), 409],
    [new Error("private SQL constraint and credential"), 503],
  ] as const)("sanitizes domain failure %#", async (error, status) => {
    onboarding.createChurch.mockRejectedValue(error);
    const res = await post().expect(status);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(res.body).includes("private SQL")).toBe(false);
    expect(res.body.statusCode).toBe(status);
  });
  it("allows three attempts, denies the fourth before orchestration", async () => {
    onboarding.createChurch.mockRejectedValue(new OnboardingDeniedError());
    for (let n = 0; n < 3; n++) await post().expect(403);
    const res = await post().expect(429);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(onboarding.createChurch).toHaveBeenCalledTimes(3);
  });
  it("explicit serialization strips even unexpected internal service fields", async () => {
    onboarding.createChurch.mockResolvedValue({
      ...safe,
      session: "private",
      audit: "private",
      roles: [],
      church: { ...safe.church, token: "private" },
      ownership: { ...safe.ownership, auditId: "private" },
    });
    const res = await post().expect(201);
    expect(res.body).toEqual(safe);
  });
  it.each(["get", "patch", "put", "delete"] as const)(
    "has no %s church collection route",
    async (method) => {
      await request(app.getHttpServer())
        [method]("/api/v1/churches")
        .expect(404);
    },
  );
  it.each([
    "/churches/other",
    "/churches/other/members",
    "/churches/other/roles",
    "/churches/other/owner",
    "/churches/other/verification",
    "/onboarding",
  ])("does not expose management route %s", async (path) => {
    await request(app.getHttpServer())
      .post("/api/v1" + path)
      .expect(404);
    expect(onboarding.createChurch).not.toHaveBeenCalled();
  });
});
it("limiter uses a sliding hour, isolates users and expires at the exact boundary", () => {
  const limiter = new OnboardingLimiter();
  limiter.consume("A", 0);
  limiter.consume("A", 100);
  limiter.consume("A", 200);
  expect(() => limiter.consume("A", 3599999)).toThrow(
    "Onboarding rate limit exceeded",
  );
  expect(() => limiter.consume("B", 3599999)).not.toThrow();
  expect(() => limiter.consume("A", 3600000)).not.toThrow();
  expect(() => limiter.consume("A", 3600001)).toThrow();
});
