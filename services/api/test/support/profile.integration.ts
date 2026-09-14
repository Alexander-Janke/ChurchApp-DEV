import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { ProfileRepository } from "../../src/profile/profile.repository.js";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { AuthEmailSender } from "../../src/auth/auth-email.js";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { DATABASE_POOL } from "../../src/database/database.constants.js";
import { TestAuthEmailSender } from "./auth-email.js";

export function profileIntegrationTests() {
  describe("self-profile against disposable PostgreSQL", () => {
    const databaseName = "profile_test_" + randomUUID().replaceAll("-", "");
    const sender = new TestAuthEmailSender();
    const origin = "http://localhost:3001";
    const password = "profile-test-only strong password";
    const email = "profile@example.invalid";
    const folder = fileURLToPath(new URL("../../migrations", import.meta.url));
    let maintenance: Pool, pool: Pool, app: NestExpressApplication;
    let created = false;
    let id: string, cookie: string;
    beforeAll(async () => {
      const url = new URL(getDatabaseUrl());
      maintenance = new Pool({ connectionString: url.toString() });
      await maintenance.query(
        `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
      );
      created = true;
      url.pathname = "/" + databaseName;
      pool = new Pool({ connectionString: url.toString() });
      await migrate(drizzle(pool), { migrationsFolder: folder });
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "profile-tests-only-not-a-runtime-secret-12345",
      );
      vi.stubEnv("BETTER_AUTH_URL", origin);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DATABASE_POOL)
        .useValue(pool)
        .overrideProvider(AuthEmailSender)
        .useValue(sender)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
      configureApp(app);
      await app.init();
    }, 30000);
    afterAll(async () => {
      try {
        if (app) await app.close();
        else await pool?.end();
      } finally {
        try {
          if (created)
            await maintenance.query(`DROP DATABASE "${databaseName}"`);
        } finally {
          await maintenance?.end();
          vi.unstubAllEnvs();
        }
      }
    });
    beforeEach(async () => {
      sender.reset();
      await pool.query(
        'TRUNCATE "user", "account", "session", "verification" CASCADE',
      );
      id = await register(email);
      cookie = await login(email);
    });
    afterEach(async () => {
      await sender.onModuleDestroy();
      sender.reset();
      vi.restoreAllMocks();
    });
    async function register(address: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/sign-up/email")
        .set("Origin", origin)
        .send({ name: "Auth compatibility name", email: address, password })
        .expect(200);
      const url = new URL(sender.messages.at(-1)!.url);
      await request(app.getHttpServer())
        .get(url.pathname + url.search)
        .expect(302);
      return res.body.user.id as string;
    }
    async function login(address: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/sign-in/email")
        .set("Origin", origin)
        .send({ email: address, password })
        .expect(200);
      const headers: unknown = res.headers["set-cookie"];
      const values: string[] = Array.isArray(headers) ? headers : [];
      const result = values
        .find((v) => v.startsWith("better-auth.session_token="))
        ?.split(";")[0];
      if (!result) throw new Error("Missing test session");
      return result;
    }
    function get(c = cookie) {
      return request(app.getHttpServer())
        .get("/api/v1/profile/me")
        .set("Cookie", c);
    }
    function patch(body: unknown, c = cookie) {
      return request(app.getHttpServer())
        .patch("/api/v1/profile/me")
        .set("Cookie", c)
        .set("Origin", origin)
        .send(body as object);
    }
    function current(c = cookie) {
      return request(app.getHttpServer())
        .get("/api/v1/auth/get-session")
        .set("Cookie", c);
    }
    async function profileRows() {
      return (await pool.query("SELECT * FROM user_profile ORDER BY user_id"))
        .rows;
    }

    it("upgrades 0000/0001 with existing identity and email-change data, then reruns safely", async () => {
      const upgradeName = "profile_upgrade_" + randomUUID().replaceAll("-", "");
      const cacheRoot = fileURLToPath(
        new URL("../../../../.cache/", import.meta.url),
      );
      mkdirSync(cacheRoot, { recursive: true });
      const priorFolder = mkdtempSync(
        join(cacheRoot, "profile-prior-migrations-"),
      );
      mkdirSync(join(priorFolder, "meta"));
      const journal = JSON.parse(
        readFileSync(join(folder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 2);
      writeFileSync(
        join(priorFolder, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const name of [
        "0000_auth_foundation.sql",
        "0001_email_change_workflow.sql",
      ])
        copyFileSync(join(folder, name), join(priorFolder, name));
      let upgradePool: Pool | undefined;
      let upgradeCreated = false;
      try {
        await maintenance.query(
          `CREATE DATABASE "${upgradeName}" TEMPLATE template0`,
        );
        upgradeCreated = true;
        const url = new URL(getDatabaseUrl());
        url.pathname = "/" + upgradeName;
        upgradePool = new Pool({ connectionString: url.toString() });
        await migrate(drizzle(upgradePool), { migrationsFolder: priorFolder });
        await upgradePool.query(
          'INSERT INTO "user"(id,name,email,email_verified) VALUES ($1,$2,$3,true)',
          ["upgrade-user", "Existing identity", "upgrade@example.invalid"],
        );
        await upgradePool.query(
          "INSERT INTO email_change_request(id,user_id,initiating_session_id,current_email,new_email,status,expires_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now(),now())",
          [
            "upgrade-workflow",
            "upgrade-user",
            "revoked-session-snapshot",
            "upgrade@example.invalid",
            "new@example.invalid",
            "superseded",
          ],
        );
        const beforeUser = JSON.stringify(
          (
            await upgradePool.query(
              'SELECT id,name,email,email_verified,image,created_at,updated_at FROM "user"',
            )
          ).rows,
        );
        const beforeWorkflow = JSON.stringify(
          (await upgradePool.query("SELECT * FROM email_change_request")).rows,
        );
        await migrate(drizzle(upgradePool), { migrationsFolder: folder });
        await migrate(drizzle(upgradePool), { migrationsFolder: folder });
        expect(
          JSON.stringify(
            (
              await upgradePool.query(
                'SELECT id,name,email,email_verified,image,created_at,updated_at FROM "user"',
              )
            ).rows,
          ) === beforeUser,
        ).toBe(true);
        expect(
          JSON.stringify(
            (await upgradePool.query("SELECT * FROM email_change_request"))
              .rows,
          ) === beforeWorkflow,
        ).toBe(true);
        expect(
          (await upgradePool.query("SELECT count(*)::int n FROM user_profile"))
            .rows[0].n,
        ).toBe(0);
        expect(
          (
            await upgradePool.query(
              "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
            )
          ).rows[0].n,
        ).toBe(7);
      } finally {
        await upgradePool?.end();
        if (upgradeCreated)
          await maintenance.query(`DROP DATABASE "${upgradeName}"`);
        const relativePath = relative(cacheRoot, priorFolder);
        if (
          relativePath.startsWith("profile-prior-migrations-") &&
          !relativePath.includes("..") &&
          dirname(priorFolder) === resolve(cacheRoot)
        )
          rmSync(priorFolder, { recursive: true });
      }
    });

    it("requires authentication on both endpoints", async () => {
      await get("").expect(401);
      await patch({ username: "alex" }, "").expect(401);
    });
    it("returns a nullable self-profile without lazy writes or private internals", async () => {
      const res = await get().expect(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          "id",
          "email",
          "emailVerified",
          "image",
          "username",
          "firstName",
          "lastName",
          "dateOfBirth",
          "phoneNumber",
          "address",
          "biography",
          "identityCreatedAt",
          "profileCreatedAt",
          "profileUpdatedAt",
        ].sort(),
      );
      expect(res.body.id).toBe(id);
      expect(res.body.email).toBe(email);
      expect(res.body.emailVerified).toBe(true);
      for (const field of [
        "username",
        "firstName",
        "lastName",
        "dateOfBirth",
        "phoneNumber",
        "address",
        "biography",
        "profileCreatedAt",
        "profileUpdatedAt",
      ])
        expect(res.body[field]).toBeNull();
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(await profileRows()).toHaveLength(0);
    });
    it.each(["Alex", "alex", "ALEx"])(
      "creates one profile and persists canonical username %s",
      async (username) => {
        const res = await patch({ username }).expect(200);
        expect(res.body.username).toBe("alex");
        expect(await profileRows()).toHaveLength(1);
        expect((await profileRows())[0].username).toBe("alex");
      },
    );
    it("rejects duplicate canonical usernames safely", async () => {
      await patch({ username: "Alex" }).expect(200);
      await register("other@example.invalid");
      const b = await login("other@example.invalid");
      const res = await patch({ username: "ALEx" }, b).expect(409);
      expect(res.body.message).toBe("Username is unavailable");
      expect(JSON.stringify(res.body).includes(email)).toBe(false);
      expect(await profileRows()).toHaveLength(1);
    });
    it("allows at most one concurrent claimant", async () => {
      await register("other@example.invalid");
      const b = await login("other@example.invalid");
      const results = await Promise.all([
        patch({ username: "Race" }),
        patch({ username: "race" }, b),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await profileRows()).toHaveLength(1);
    });
    it("preserves Unicode structured names without altering auth name", async () => {
      const res = await patch({
        firstName: "  Élodie 林 ",
        lastName: " Müller ",
      }).expect(200);
      expect(res.body.firstName).toBe("Élodie 林");
      expect(res.body.lastName).toBe("Müller");
      expect(
        (await pool.query('SELECT name FROM "user" WHERE id=$1', [id])).rows[0]
          .name,
      ).toBe("Auth compatibility name");
    });
    it("stores date-only DOB and canonical E.164 phone", async () => {
      const res = await patch({
        dateOfBirth: "2000-02-29",
        phoneNumber: "+49123456789",
      }).expect(200);
      expect(res.body.dateOfBirth).toBe("2000-02-29");
      expect(res.body.phoneNumber).toBe("+49123456789");
    });
    it.each([
      { dateOfBirth: "9999-12-31" },
      { dateOfBirth: "2025-02-29" },
      { phoneNumber: "+49 1234567" },
      { firstName: " " },
      { lastName: "x".repeat(101) },
      { username: "a" },
      { biography: "x".repeat(2001) },
      { image: "javascript:alert(1)" },
      { image: "https://u:p@example.test/x" },
      { address: { countryCode: "de" } },
    ])("rejects invalid profile fields %#", async (body) => {
      await patch(body).expect(400);
      expect(await profileRows()).toHaveLength(0);
    });
    it("replaces and clears the structured address explicitly", async () => {
      await patch({
        address: {
          line1: "One",
          line2: "Two",
          postalCode: "123",
          locality: "Berlin",
          region: "Berlin",
          countryCode: "DE",
        },
      }).expect(200);
      const replaced = await patch({
        address: { locality: "Hamburg", countryCode: "DE" },
      }).expect(200);
      expect(replaced.body.address).toEqual({
        line1: null,
        line2: null,
        postalCode: null,
        locality: "Hamburg",
        region: null,
        countryCode: "DE",
      });
      expect(
        (await patch({ address: null }).expect(200)).body.address,
      ).toBeNull();
    });
    it("preserves biography text and line breaks", async () => {
      const biography = "Text <not HTML semantics>\nSecond line 🌍";
      expect((await patch({ biography }).expect(200)).body.biography).toBe(
        biography,
      );
    });
    it("updates and removes canonical user.image", async () => {
      const image = "https://example.test/profile.png";
      await patch({ image }).expect(200);
      expect((await current().expect(200)).body.user.image).toBe(image);
      expect((await patch({ image: null }).expect(200)).body.image).toBeNull();
    });
    it("preserves omitted values and permits nullable clearing", async () => {
      await patch({
        firstName: "One",
        lastName: "Two",
        biography: "Text",
      }).expect(200);
      const res = await patch({ firstName: null }).expect(200);
      expect(res.body.firstName).toBeNull();
      expect(res.body.lastName).toBe("Two");
      expect(res.body.biography).toBe("Text");
    });
    it("sanitizes storage failures without leaking diagnostics", async () => {
      const privateDiagnostic = "private-db-diagnostic-and-session-value";
      vi.spyOn(app.get(ProfileRepository), "read").mockRejectedValueOnce(
        new Error(privateDiagnostic),
      );
      const response = await get().expect(503);
      expect(response.body.message).toBe("Profile operation unavailable");
      expect(response.text.includes(privateDiagnostic)).toBe(false);
    });
    it("rejects an empty patch", async () => {
      await patch({}).expect(400);
    });
    it.each([
      "id",
      "email",
      "emailVerified",
      "createdAt",
      "updatedAt",
      "name",
      "twoFactorEnabled",
      "password",
      "currentPassword",
      "newPassword",
      "userId",
      "churchId",
      "membership",
      "role",
      "roles",
      "permission",
      "permissions",
      "sessionId",
      "unknown",
    ])("rejects protected/unknown %s without state changes", async (field) => {
      await patch({
        firstName: "Not persisted",
        [field]: "private-injected-value",
      }).expect(400);
      expect(await profileRows()).toHaveLength(0);
      const self = await get().expect(200);
      expect(self.body.email).toBe(email);
      expect(self.body.emailVerified).toBe(true);
      expect(self.body.id).toBe(id);
    });
    it("rejects nested protected address fields", async () => {
      await patch({ address: { line1: "x", userId: id } }).expect(400);
    });
    it("requires trusted Origin on writes and rejects selector queries or arbitrary user routes", async () => {
      await request(app.getHttpServer())
        .patch("/api/v1/profile/me")
        .set("Cookie", cookie)
        .send({ username: "alex" })
        .expect(403);
      await request(app.getHttpServer())
        .patch("/api/v1/profile/me")
        .set("Cookie", cookie)
        .set("Origin", "https://attacker.invalid")
        .send({ username: "alex" })
        .expect(403);
      await get().query({ userId: "another-user" }).expect(400);
      await patch({ username: "alex" })
        .query({ userId: "another-user" })
        .expect(400);
      await request(app.getHttpServer())
        .get("/api/v1/profile/" + id)
        .set("Cookie", cookie)
        .expect(404);
    });
    it("preserves identities, credentials, sessions and other users", async () => {
      const bId = await register("other@example.invalid"),
        b = await login("other@example.invalid");
      await patch({ firstName: "Other" }, b).expect(200);
      await login(email);
      const accountBefore = JSON.stringify(
        (await pool.query("SELECT * FROM account ORDER BY id")).rows,
      );
      const sessionsBefore = JSON.stringify(
        (await pool.query("SELECT * FROM session ORDER BY id")).rows,
      );
      const otherBefore = JSON.stringify((await get(b).expect(200)).body);
      const res = await patch({
        firstName: "Self",
        image: "https://example.test/self.png",
      }).expect(200);
      expect(res.body.id).toBe(id);
      expect(res.body.email).toBe(email);
      expect(res.body.emailVerified).toBe(true);
      expect(
        JSON.stringify(
          (await pool.query("SELECT * FROM account ORDER BY id")).rows,
        ) === accountBefore,
      ).toBe(true);
      expect(
        JSON.stringify(
          (await pool.query("SELECT * FROM session ORDER BY id")).rows,
        ) === sessionsBefore,
      ).toBe(true);
      expect(
        JSON.stringify((await get(b).expect(200)).body) === otherBefore,
      ).toBe(true);
      expect((await current().expect(200)).body.user.id).toBe(id);
      expect((await get(b).expect(200)).body.id).toBe(bId);
      await login(email);
    });
    it("rejects absolute-expired and revoked sessions", async () => {
      await pool.query(
        "UPDATE session SET created_at=now()-interval '31 days',expires_at=now()+interval '1 day' WHERE user_id=$1",
        [id],
      );
      await get().expect(401);
      await patch({ username: "alex" }).expect(401);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM session WHERE user_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(await profileRows()).toHaveLength(0);
    });
    it("preserves both separate-field concurrent updates and advances profile timestamps", async () => {
      await patch({ firstName: "Before" }).expect(200);
      const before = (await get().expect(200)).body;
      const results = await Promise.all([
        patch({ firstName: "After" }),
        patch({ lastName: "Separate" }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const after = (await get().expect(200)).body;
      expect(after.firstName).toBe("After");
      expect(after.lastName).toBe("Separate");
      expect(Date.parse(after.profileUpdatedAt)).toBeGreaterThanOrEqual(
        Date.parse(before.profileUpdatedAt),
      );
      expect(after.profileCreatedAt).toBe(before.profileCreatedAt);
    });
    it("rolls back image updates if username conflicts", async () => {
      await patch({ username: "alex" }).expect(200);
      await register("other@example.invalid");
      const b = await login("other@example.invalid");
      await patch(
        { username: "alex", image: "https://example.test/not-committed" },
        b,
      ).expect(409);
      expect((await get(b).expect(200)).body.image).toBeNull();
    });
    it("enforces database ownership, canonical username constraints and cascade deletion", async () => {
      await patch({ username: "alex" }).expect(200);
      await expect(
        pool.query("INSERT INTO user_profile(user_id) VALUES ($1)", [id]),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        pool.query("UPDATE user_profile SET username='ALEx' WHERE user_id=$1", [
          id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query("INSERT INTO user_profile(user_id) VALUES ('absent-user')"),
      ).rejects.toMatchObject({ code: "23503" });
      await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
      expect(await profileRows()).toHaveLength(0);
    });
    it("repeated migrations preserve profile and identity data with exactly seven applied entries", async () => {
      await patch({ username: "alex", dateOfBirth: "2000-02-29" }).expect(200);
      const before = JSON.stringify(await profileRows());
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(JSON.stringify(await profileRows()) === before).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(7);
      expect((await get().expect(200)).body.id).toBe(id);
    });
  });
}
