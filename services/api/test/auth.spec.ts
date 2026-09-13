import "reflect-metadata";
import { Body, Controller, Post } from "@nestjs/common";
import { Pool } from "pg";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import {
  AuthConfigurationError,
  getBetterAuthSecret,
  getBetterAuthUrl,
} from "../src/auth/auth.config.js";
import { DATABASE_POOL } from "../src/database/database.constants.js";

const TEST_SECRET = "test-only-secret-that-is-at-least-32-characters";

@Controller("auth-parser-fixture")
class AuthParserFixtureController {
  @Post()
  echo(@Body() body: { value?: string }): { value?: string } {
    return body;
  }
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", TEST_SECRET);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/database");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Better Auth configuration", () => {
  it("accepts a valid secret and absolute HTTP(S) URL", () => {
    expect(getBetterAuthSecret()).toBe(TEST_SECRET);
    expect(getBetterAuthUrl()).toBe("http://localhost:3001");
  });

  it("rejects a missing or short secret without exposing a value", () => {
    expect(() => getBetterAuthSecret(" ")).toThrow(AuthConfigurationError);
    expect(() => getBetterAuthSecret("short-sensitive-value")).toThrow(
      "at least 32 characters",
    );
    try {
      getBetterAuthSecret("short-sensitive-value");
    } catch (error) {
      expect((error as Error).message).not.toContain("short-sensitive-value");
    }
  });

  it("rejects malformed or non-HTTP(S) base URLs", () => {
    expect(() => getBetterAuthUrl("not-a-url")).toThrow("absolute HTTP(S) URL");
    expect(() => getBetterAuthUrl("ftp://localhost/auth")).toThrow(
      "absolute HTTP(S) URL",
    );
  });
});

describe("Better Auth Nest boundary", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthParserFixtureController],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(new Pool())
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
  });

  it("keeps health public and exposes Better Auth below the API namespace", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect({ status: "ok" });

    await request(app.getHttpServer()).get("/api/v1/auth/ok").expect(200);
    await request(app.getHttpServer()).get("/api/auth/ok").expect(404);

    await request(app.getHttpServer())
      .post("/api/v1/auth-parser-fixture")
      .send({ value: "parsed" })
      .expect(201)
      .expect({ value: "parsed" });
  });

  it("loads one application-owned Better Auth integration", () => {
    const first = app.get(AuthService).instance;
    const second = app.get(AuthService).instance;
    expect(first).toBe(second);
  });

  afterEach(async () => {
    await app?.close();
  });
});
