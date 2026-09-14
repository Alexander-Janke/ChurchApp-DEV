import "reflect-metadata";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { getDatabaseUrl } from "../../../src/database/database.config.js";
import { DatabaseService } from "../../../src/database/database.service.js";
import { TenantDatabase } from "../../../src/database/tenant-database.js";
import {
  assertDisposableNames,
  assertRestrictedRole,
  grantRuntimeTables,
  tableIdentifiers,
} from "./runtime-role.js";
import { migrateFixture } from "./migration-fixture.js";

export interface TenantFixtureOptions {
  protectedTables: readonly string[];
  upgrade?: {
    throughTag: string;
    // Only privileged setup callbacks. Module-specific preservation assertions stay in the suite.
    before: (fixturePool: Pool) => Promise<void>;
    after?: (fixturePool: Pool) => Promise<void>;
  };
}

export async function createTenantTestFixture(options: TenantFixtureOptions) {
  const tables = [...options.protectedTables];
  tableIdentifiers(tables); // Reject unsafe configuration before opening any connection.
  const suffix = randomUUID().replaceAll("-", "");
  const databaseName = "tenant_test_" + suffix;
  const roleName = "tenant_runtime_" + suffix;
  assertDisposableNames(databaseName, roleName);
  const url = new URL(getDatabaseUrl());
  const maintenance = new Pool({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  let created = false,
    roleCreated = false;
  const pools: Pool[] = [];
  const services = new Map<Pool, DatabaseService>();
  let shutdown: Promise<void> | undefined;

  // All callers share cleanup, including partial setup failures. Only resources
  // successfully created by this invocation can be dropped; names are rechecked.
  function dispose(): Promise<void> {
    return (shutdown ??= (async () => {
      assertDisposableNames(databaseName, roleName);
      const results = await Promise.allSettled(
        pools.map(
          (pool) => services.get(pool)?.onModuleDestroy() ?? pool.end(),
        ),
      );
      let failed = results.some((result) => result.status === "rejected");
      try {
        if (created) {
          try {
            await maintenance.query(`DROP DATABASE "${databaseName}"`);
            created = false;
          } catch {
            failed = true;
          }
        }
        if (roleCreated) {
          try {
            await maintenance.query(`DROP ROLE "${roleName}"`);
            roleCreated = false;
          } catch {
            failed = true;
          }
        }
        const remaining = await maintenance.query(
          "select exists(select 1 from pg_database where datname=$1) db, exists(select 1 from pg_roles where rolname=$2) role",
          [databaseName, roleName],
        );
        if (remaining.rows[0].db || remaining.rows[0].role) failed = true;
      } catch {
        failed = true;
      } finally {
        await maintenance.end();
      }
      if (failed)
        throw new Error(
          "Tenant fixture cleanup failed; inspect disposable resource names",
        );
    })());
  }
  try {
    await maintenance.query(
      `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
    );
    created = true;
    url.pathname = "/" + databaseName;
    const fixturePool = new Pool({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
    });
    pools.push(fixturePool);
    if (options.upgrade) {
      await migrateFixture(fixturePool, options.upgrade.throughTag);
      await options.upgrade.before(fixturePool);
    }
    await migrateFixture(fixturePool);
    await options.upgrade?.after?.(fixturePool);

    // Generated hex-only password exists solely in memory.
    const password = randomBytes(32).toString("hex");
    await maintenance.query(
      `CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
    );
    roleCreated = true;
    await grantRuntimeTables(fixturePool, databaseName, roleName, tables);
    url.username = roleName;
    url.password = password;
    const runtimePool = new Pool({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    const concurrentPool = new Pool({
      connectionString: url.toString(),
      max: 2,
      connectionTimeoutMillis: 5000,
    });
    pools.push(runtimePool, concurrentPool);
    await assertRestrictedRole(runtimePool, tables, roleName);
    await assertRestrictedRole(concurrentPool, tables, roleName);
    const fixtureDb = new DatabaseService(fixturePool);
    const runtimeDb = new DatabaseService(runtimePool);
    const concurrentDb = new DatabaseService(concurrentPool);
    services.set(fixturePool, fixtureDb);
    services.set(runtimePool, runtimeDb);
    services.set(concurrentPool, concurrentDb);
    const tenantDatabase = new TenantDatabase(runtimeDb);
    return {
      databaseName,
      roleName,
      fixturePool,
      fixtureDb,
      runtimePool,
      runtimeDb,
      concurrentPool,
      concurrentDb,
      tenantDatabase,
      concurrentTenantDatabase: new TenantDatabase(concurrentDb),
      withTenant: tenantDatabase.transaction.bind(tenantDatabase),
      assertRestrictedRole: () =>
        assertRestrictedRole(runtimePool, tables, roleName),
      dispose,
    };
  } catch {
    await dispose();
    // Never attach the driver error/cause: it could contain connection credentials.
    throw new Error("Tenant fixture setup failed");
  }
}
export type TenantTestFixture = Awaited<
  ReturnType<typeof createTenantTestFixture>
>;
