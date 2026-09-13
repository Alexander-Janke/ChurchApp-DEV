import { Pool } from "pg";
import { DATABASE_POOL } from "../src/database/database.constants.js";
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";

describe("API shell", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "test-only-secret-that-is-at-least-32-characters",
    );
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(new Pool())
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it("returns the stable health response without framework headers", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("does not expose an unversioned health route", async () => {
    await request(app.getHttpServer()).get("/health").expect(404);
  });
});
