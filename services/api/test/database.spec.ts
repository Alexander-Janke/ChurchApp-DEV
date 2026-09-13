import "reflect-metadata";
import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDatabaseUrl } from "../src/database/database.config.js";
import { DATABASE_POOL } from "../src/database/database.constants.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { DatabaseService } from "../src/database/database.service.js";

function deferredShutdown() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const release = vi.fn();
  const pool = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockResolvedValue({ query, release }),
    end: vi.fn().mockResolvedValue(undefined),
  });
  const service = new DatabaseService(pool as unknown as Pool);
  return { pool, service, query, release };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("database configuration", () => {
  it("rejects missing configuration during Nest initialization", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(
      Test.createTestingModule({ imports: [DatabaseModule] }).compile(),
    ).rejects.toThrow("DATABASE_URL is required");
  });
  it("validates configuration without disclosing its value", () => {
    expect(() => getDatabaseUrl("  ")).toThrow("DATABASE_URL is required");
    expect(() => getDatabaseUrl("not-a-url-sensitive-value")).toThrow(
      "DATABASE_URL must be a PostgreSQL URL with a host and database",
    );
    expect(() => getDatabaseUrl("https://localhost/database")).toThrow();
    expect(getDatabaseUrl("postgresql://localhost/database")).toBe(
      "postgresql://localhost/database",
    );
  });
});

describe("database lifecycle and transactions", () => {
  it("closes the Nest-owned pool when the module closes", async () => {
    const { pool } = fixture();
    const module = await Test.createTestingModule({ imports: [DatabaseModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();
    await module.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });
  it("logs idle failures without error or credential details", async () => {
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    const { pool, service } = fixture();
    pool.emit("error", new Error("sensitive-connection-details"));
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Unexpected idle PostgreSQL connection error",
    );
    await service.onModuleDestroy();
    expect(pool.listenerCount("error")).toBe(0);
  });
  it("releases a borrowed client", async () => {
    const { service, release } = fixture();
    expect(await service.withClient(async () => 42)).toBe(42);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("commits through one acquired client", async () => {
    const { service, pool, query, release } = fixture();
    await service.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
    });
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(query.mock.calls.map((call) => call[0].text)).toEqual([
      "begin",
      "select 1",
      "commit",
    ]);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("rolls back failed work and releases the client", async () => {
    const { service, query, release } = fixture();
    await expect(
      service.transaction(async () => {
        throw new Error("work failed");
      }),
    ).rejects.toThrow("work failed");
    expect(query.mock.calls.map((call) => call[0].text)).toEqual([
      "begin",
      "rollback",
    ]);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("releases even when BEGIN fails", async () => {
    const { service, query, release } = fixture();
    query.mockRejectedValueOnce(new Error("begin failed"));
    await expect(service.transaction(async () => {})).rejects.toThrow();
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("releases even when rollback fails", async () => {
    const { service, query, release } = fixture();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("rollback failed"));
    await expect(
      service.transaction(async () => {
        throw new Error("work failed");
      }),
    ).rejects.toThrow();
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("propagates acquisition failure without attempting release", async () => {
    const { service, pool, release } = fixture();
    pool.connect.mockRejectedValueOnce(new Error("unavailable"));
    await expect(service.withClient(async () => {})).rejects.toThrow(
      "unavailable",
    );
    expect(release).not.toHaveBeenCalled();
  });
  it("sanitizes shutdown errors", async () => {
    const { service, pool } = fixture();
    pool.end.mockRejectedValueOnce(new Error("sensitive-details"));
    await expect(service.onModuleDestroy()).rejects.toThrow(
      "PostgreSQL pool shutdown failed",
    );
    expect(pool.listenerCount("error")).toBe(0);
  });
  it("shares concurrent and repeated successful shutdown", async () => {
    const { service, pool } = fixture();
    const pending = deferredShutdown();
    pool.end.mockReturnValueOnce(pending.promise);
    const first = service.onModuleDestroy();
    expect(service.onModuleDestroy()).toBe(first);
    await Promise.resolve();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(pool.listenerCount("error")).toBe(1);
    pending.resolve();
    await first;
    expect(service.onModuleDestroy()).toBe(first);
    await service.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(pool.listenerCount("error")).toBe(0);
  });
  it("shares the same sanitized shutdown failure without retrying", async () => {
    const { service, pool } = fixture();
    const pending = deferredShutdown();
    pool.end.mockReturnValueOnce(pending.promise);
    const first = service.onModuleDestroy();
    const second = service.onModuleDestroy();
    expect(second).toBe(first);
    const resultsPromise = Promise.allSettled([first, second]);
    pending.reject(new Error("sensitive-connection-details"));
    const results = await resultsPromise;
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    if (results[0].status !== "rejected" || results[1].status !== "rejected") {
      throw new Error("Expected both shutdown calls to reject");
    }
    expect(results[0].reason).toBe(results[1].reason);
    expect(results[0].reason.message).toBe("PostgreSQL pool shutdown failed");
    expect(results[0].reason.cause).toBeUndefined();
    expect(service.onModuleDestroy()).toBe(first);
    await expect(service.onModuleDestroy()).rejects.toBe(results[0].reason);
    expect(pool.end).toHaveBeenCalledOnce();
    expect(pool.listenerCount("error")).toBe(0);
  });
  it("rolls back and discards the client when COMMIT fails after successful work", async () => {
    const { service, pool, query, release } = fixture();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("commit failed"));
    const work = vi.fn(
      async (
        tx: Parameters<Parameters<DatabaseService["transaction"]>[0]>[0],
      ) => {
        await tx.execute(sql`select 1`);
      },
    );
    await expect(service.transaction(work)).rejects.toThrow();
    expect(work).toHaveBeenCalledOnce();
    expect(query.mock.calls.map((call) => call[0].text)).toEqual([
      "begin",
      "select 1",
      "commit",
      "rollback",
    ]);
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
