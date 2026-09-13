import "reflect-metadata";
import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_POOL } from "../src/database/database.constants.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { DatabaseService } from "../src/database/database.service.js";

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
