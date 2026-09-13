import "reflect-metadata";
import { Body, Controller, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IsString } from "class-validator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureApp } from "../src/configure-app.js";

// Test-only route: validates shared bootstrap behavior without adding a product DTO.
class InputFixture {
  @IsString()
  name!: string;
}

@Controller("validation-fixture")
class ValidationFixtureController {
  @Post()
  accept(@Body() input: InputFixture): { transformed: boolean } {
    return { transformed: input instanceof InputFixture };
  }
}

describe("global DTO validation", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ValidationFixtureController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("transforms valid input into its declared DTO", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/validation-fixture")
      .send({ name: "example" })
      .expect(201);
    expect(response.body).toEqual({ transformed: true });
  });

  it("rejects unexpected fields without echoing input", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/validation-fixture")
      .send({ name: "example", protectedField: "private-test-value" })
      .expect(400);
    expect(response.text).not.toContain("private-test-value");
  });

  it("rejects invalid declared fields", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/validation-fixture")
      .send({ name: 123 })
      .expect(400);
  });
});
