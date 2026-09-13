import "reflect-metadata";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { AuthModule } from "../src/auth/auth.module.js";
import type { createBetterAuth } from "../src/auth/auth.config.js";
import { getDatabaseUrl } from "../src/database/database.config.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DATABASE_POOL } from "../src/database/database.constants.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { DatabaseService } from "../src/database/database.service.js";
import { registrationIntegrationTests } from "./support/registration.integration.js";
import { sessionIntegrationTests } from "./support/session.integration.js";

describe("real PostgreSQL foundation", () => {
  let module: TestingModule;
  let service: DatabaseService;
  let pool: Pool;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    service = module.get(DatabaseService);
    pool = module.get<Pool>(DATABASE_POOL);
  });
  afterAll(async () => {
    await module?.close();
  });

  it("queries the configured pool through Drizzle and reports server version", async () => {
    const result = await service.db.execute(
      sql`select 1 as value, current_setting('server_version') as version`,
    );
    expect(result.rows[0]?.value).toBe(1);
    console.info("PostgreSQL server version:", result.rows[0]?.version);
    expect(pool.totalCount).toBeGreaterThan(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
  it("commits and releases a single-client transaction", async () => {
    const id = await service.transaction(async (tx) => {
      const first = await tx.execute(
        sql`select pg_current_xact_id()::text as id, pg_backend_pid() as pid`,
      );
      const second = await tx.execute(sql`select pg_backend_pid() as pid`);
      expect(second.rows[0]?.pid).toBe(first.rows[0]?.pid);
      return String(first.rows[0]?.id);
    });
    const result = await service.db.execute(
      sql`select pg_xact_status(${id}::xid8) as status`,
    );
    expect(result.rows[0]?.status).toBe("committed");
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });
  it("rolls back failed work and releases its client", async () => {
    let id = "";
    await expect(
      service.transaction(async (tx) => {
        const result = await tx.execute(
          sql`select pg_current_xact_id()::text as id`,
        );
        id = String(result.rows[0]?.id);
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");
    const result = await service.db.execute(
      sql`select pg_xact_status(${id}::xid8) as status`,
    );
    expect(result.rows[0]?.status).toBe("aborted");
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });
});

registrationIntegrationTests();
sessionIntegrationTests();

// A unique database keeps migration/constraint tests away from existing local data.
// The configured test role needs CREATEDB; it is not a production runtime role.
describe("Better Auth migrated PostgreSQL schema", () => {
  const databaseName = `auth_schema_test_${randomUUID().replaceAll("-", "")}`;
  const migrationsFolder = fileURLToPath(
    new URL("../migrations", import.meta.url),
  );
  let maintenance: Pool;
  let pool: Pool;
  let app: NestExpressApplication;
  let created = false;

  beforeAll(async () => {
    const url = new URL(getDatabaseUrl());
    maintenance = new Pool({ connectionString: url.toString() });
    // Identifier is wholly generated here, never supplied by a request or environment.
    await maintenance.query(
      `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
    );
    created = true;
    url.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: url.toString() });
    await migrate(drizzle(pool), { migrationsFolder });
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "database-test-only-not-a-runtime-secret-12345",
    );
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    await app.init();
  }, 30_000);

  afterAll(async () => {
    try {
      if (app) await app.close();
      else await pool?.end();
    } finally {
      try {
        if (created) await maintenance.query(`DROP DATABASE "${databaseName}"`);
      } finally {
        await maintenance?.end();
        vi.unstubAllEnvs();
      }
    }
  });

  async function rolledBack(work: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await work(client);
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  }

  it("migrates a clean database and safely skips the applied migration on a second run", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
    const journal = await pool.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(journal.rows[0].count).toBe(1);
  });

  it("starts AuthModule with default schema validation and queries every model through its real adapter", async () => {
    const context =
      await app.get<AuthService<ReturnType<typeof createBetterAuth>>>(
        AuthService,
      ).instance.$context;
    expect(context.checkSchema).toBeTypeOf("function");
    await context.checkSchema!();
    for (const model of ["user", "session", "account", "verification"]) {
      await expect(
        context.adapter.findMany({ model, limit: 1 }),
      ).resolves.toEqual([]);
    }
  });

  it("creates the generator's lookup indexes and unique constraints", async () => {
    const result = await pool.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    );
    expect(result.rows.map((row) => row.indexname)).toEqual([
      "account_pkey",
      "account_userId_idx",
      "session_pkey",
      "session_token_unique",
      "session_userId_idx",
      "user_email_unique",
      "user_pkey",
      "verification_identifier_idx",
      "verification_pkey",
    ]);
    for (const name of ["user_email_unique", "session_token_unique"]) {
      expect(
        result.rows.find((row) => row.indexname === name)?.indexdef,
      ).toContain("UNIQUE INDEX");
    }
  });

  it("rejects duplicate user emails", async () => {
    await rolledBack(async (client) => {
      await client.query(
        'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
        ["schema-user", "Schema fixture", "schema@example.invalid"],
      );
      await expect(
        client.query(
          'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
          ["other-user", "Schema fixture", "schema@example.invalid"],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "user_email_unique",
      });
    });
  });

  it("rejects duplicate opaque session tokens", async () => {
    await rolledBack(async (client) => {
      await client.query(
        'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
        ["schema-user", "Schema fixture", "schema@example.invalid"],
      );
      const insert =
        "INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, now(), now())";
      await client.query(insert, [
        "first-session",
        "non-authenticating-test-fixture",
        "schema-user",
      ]);
      await expect(
        client.query(insert, [
          "second-session",
          "non-authenticating-test-fixture",
          "schema-user",
        ]),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "session_token_unique",
      });
    });
  });

  it.each(["session", "account"])(
    "rejects a %s row whose user does not exist",
    async (table) => {
      await rolledBack(async (client) => {
        const statement =
          table === "session"
            ? "INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, now(), now())"
            : "INSERT INTO account (id, account_id, user_id, provider_id, updated_at) VALUES ($1, $2, $3, $4, now())";
        const values =
          table === "session"
            ? ["orphan", "expired-test-fixture", "missing-user"]
            : ["orphan", "schema-account", "missing-user", "schema-test"];
        await expect(client.query(statement, values)).rejects.toMatchObject({
          code: "23503",
          constraint: `${table}_user_id_user_id_fk`,
        });
      });
    },
  );

  it("cascades user deletion to sessions and accounts", async () => {
    await rolledBack(async (client) => {
      await client.query(
        'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
        ["schema-user", "Schema fixture", "schema@example.invalid"],
      );
      await client.query(
        "INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, now(), now())",
        ["schema-session", "expired-test-fixture", "schema-user"],
      );
      await client.query(
        "INSERT INTO account (id, account_id, provider_id, user_id, updated_at) VALUES ($1, $2, $3, $4, now())",
        [
          "schema-account",
          "schema-provider-account",
          "schema-test",
          "schema-user",
        ],
      );
      await client.query('DELETE FROM "user" WHERE id = $1', ["schema-user"]);
      expect((await client.query("SELECT id FROM session")).rows).toEqual([]);
      expect((await client.query("SELECT id FROM account")).rows).toEqual([]);
    });
  });
});
