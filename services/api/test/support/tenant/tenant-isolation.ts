import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect } from "vitest";
import { TenantContext } from "../../../src/database/tenant-context.js";
import type { DatabaseService } from "../../../src/database/database.service.js";
import type { DatabaseTransaction } from "../../../src/database/database.types.js";
import type { TenantTestFixture } from "./database-fixture.js";

export async function assertNoContext(
  fixture: TenantTestFixture,
  broadRead: SQL,
): Promise<void> {
  expect(
    (await fixture.runtimeDb.db.execute(broadRead)).rows,
    "Unscoped runtime must see no protected rows",
  ).toEqual([]);
  expect(
    (
      await fixture.runtimePool.query(
        "select nullif(current_setting('app.current_church_id',true),'') ctx",
      )
    ).rows[0].ctx,
  ).toBeNull();
  expect(fixture.runtimePool.waitingCount).toBe(0);
}

export async function assertScopedResult<T>(
  fixture: TenantTestFixture,
  context: TenantContext,
  operation: (tx: DatabaseTransaction) => Promise<T>,
  expected: T,
): Promise<void> {
  expect(
    await fixture.withTenant(context, operation),
    "Scoped operation result",
  ).toEqual(expected);
}

// Includes unscoped UPDATE/DELETE probes; INSERT rejection stays an explicit error assertion.
export async function assertUnscopedResult<T>(
  fixture: TenantTestFixture,
  operation: (db: DatabaseService) => Promise<T>,
  expected: T,
): Promise<void> {
  await fixture.assertRestrictedRole();
  expect(
    await operation(fixture.runtimeDb),
    "Unscoped operation result",
  ).toEqual(expected);
}

export async function assertRawRead(
  fixture: TenantTestFixture,
  context: TenantContext,
  broadRead: SQL,
  expected: unknown[],
): Promise<void> {
  await assertScopedResult(
    fixture,
    context,
    async (tx) => (await tx.execute(broadRead)).rows,
    expected,
  );
  await assertNoContext(fixture, broadRead);
}

export async function assertScopeMismatch(
  fixture: TenantTestFixture,
  repositoryScope: TenantContext,
  databaseScope: TenantContext,
  assertDenied: (
    scope: TenantContext,
    tx: DatabaseTransaction,
  ) => Promise<void>,
  assertUnchanged: () => Promise<void>,
): Promise<void> {
  expect(repositoryScope.churchId).not.toBe(databaseScope.churchId);
  await fixture.withTenant(databaseScope, (tx) =>
    assertDenied(repositoryScope, tx),
  );
  await assertUnchanged();
}

export async function assertRejectedWrite(
  fixture: TenantTestFixture,
  context: TenantContext,
  write: (tx: DatabaseTransaction) => Promise<unknown>,
  assertUnchanged: () => Promise<void>,
): Promise<void> {
  await expect(fixture.withTenant(context, write)).rejects.toThrow();
  await assertUnchanged();
}

export async function assertCommitIsolation(
  fixture: TenantTestFixture,
  context: TenantContext,
  broadRead: SQL,
  assertInside: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  const pid = await fixture.withTenant(context, async (tx) => {
    await assertInside(tx);
    return (await tx.execute(sql`select pg_backend_pid() pid`)).rows[0]?.pid;
  });
  expect(
    (await fixture.runtimePool.query("select pg_backend_pid() pid")).rows[0]
      .pid,
  ).toBe(pid);
  await assertNoContext(fixture, broadRead);
}

// Complement the production-boundary exception tests with an explicit PostgreSQL
// ROLLBACK on the SAME borrowed connection (production discards failed clients).
export async function assertRollbackIsolation(
  fixture: TenantTestFixture,
  context: TenantContext,
  broadRead: SQL,
  expected: unknown[],
): Promise<void> {
  TenantContext.assert(context);
  await fixture.assertRestrictedRole();
  const client = await fixture.runtimePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.current_church_id',$1,true)", [
      context.churchId,
    ]);
    expect((await drizzle(client).execute(broadRead)).rows).toEqual(expected);
    await client.query("ROLLBACK");
    expect((await drizzle(client).execute(broadRead)).rows).toEqual([]);
    expect(
      (
        await client.query(
          "select nullif(current_setting('app.current_church_id',true),'') ctx",
        )
      ).rows[0].ctx,
    ).toBeNull();
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
  await assertNoContext(fixture, broadRead);
}

export async function assertFailureIsolation(
  fixture: TenantTestFixture,
  context: TenantContext,
  broadRead: SQL,
  failingWork: (tx: DatabaseTransaction) => Promise<unknown>,
  assertRolledBack: () => Promise<void>,
  message?: string,
): Promise<void> {
  const result = expect(fixture.withTenant(context, failingWork)).rejects;
  if (message) await result.toThrow(message);
  else await result.toThrow();
  await assertRolledBack();
  await assertNoContext(fixture, broadRead);
  expect(fixture.runtimePool.idleCount).toBe(fixture.runtimePool.totalCount);
}

export async function assertConcurrentIsolation(
  fixture: TenantTestFixture,
  firstContext: TenantContext,
  secondContext: TenantContext,
  broadRead: SQL,
  firstRows: unknown[],
  secondRows: unknown[],
): Promise<void> {
  let arrived = 0;
  let release!: () => void;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const barrier = new Promise<void>((resolve, reject) => {
    release = resolve;
    timeout = setTimeout(
      () => reject(new Error("Both tenant transactions must overlap")),
      5000,
    );
  });
  // Register rejection handling before starting transactions (setup can itself fail).
  void barrier.catch(() => undefined);
  const run = (context: TenantContext) =>
    fixture.concurrentTenantDatabase.transaction(context, async (tx) => {
      if (++arrived === 2) release();
      await barrier;
      return {
        pid: (await tx.execute(sql`select pg_backend_pid() pid`)).rows[0]?.pid,
        rows: (await tx.execute(broadRead)).rows,
      };
    });
  try {
    const results = await Promise.allSettled([
      run(firstContext),
      run(secondContext),
    ]);
    // Drain both transactions before surfacing an assertion failure.
    const values = results.map((result) => {
      if (result.status === "rejected")
        throw new Error("Concurrent tenant probe failed");
      return result.value;
    });
    expect(arrived).toBe(2);
    expect(values[0]?.pid).not.toBe(values[1]?.pid);
    expect(values[0]?.rows).toEqual(firstRows);
    expect(values[1]?.rows).toEqual(secondRows);
    const clients = [];
    try {
      clients.push(await fixture.concurrentPool.connect());
      clients.push(await fixture.concurrentPool.connect());
      for (const client of clients) {
        expect((await drizzle(client).execute(broadRead)).rows).toEqual([]);
        expect(
          (
            await client.query(
              "select nullif(current_setting('app.current_church_id',true),'') ctx",
            )
          ).rows[0].ctx,
        ).toBeNull();
      }
    } finally {
      clients.forEach((client) => client.release());
    }
  } finally {
    clearTimeout(timeout);
  }
}
