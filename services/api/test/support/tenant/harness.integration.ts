import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../../../src/database/database.config.js";
import { createTenantTestFixture } from "./database-fixture.js";

export function tenantHarnessIntegrationTests() {
  describe("tenant harness resource safety", () => {
    async function assertAbsent(databaseName: string, roleName: string) {
      const maintenance = new Pool({ connectionString: getDatabaseUrl() });
      try {
        expect(
          (
            await maintenance.query(
              "select exists(select 1 from pg_database where datname=$1) db, exists(select 1 from pg_roles where rolname=$2) role",
              [databaseName, roleName],
            )
          ).rows,
        ).toEqual([{ db: false, role: false }]);
      } finally {
        await maintenance.end();
      }
    }
    it("creates a migrated disposable database and removes database, role and pools with shared idempotent cleanup", async () => {
      const fixture = await createTenantTestFixture({
        protectedTables: ["church", "church_membership"],
      });
      try {
        expect(
          (await fixture.runtimePool.query("select current_database() db"))
            .rows[0].db,
        ).toBe(fixture.databaseName);
        expect(
          (
            await fixture.fixturePool.query(
              "select count(*)::int n from drizzle.__drizzle_migrations",
            )
          ).rows[0].n,
        ).toBe(12);
        await fixture.assertRestrictedRole();
        const first = fixture.dispose(),
          second = fixture.dispose();
        expect(first).toBe(second);
        await Promise.all([first, second]);
        expect(fixture.runtimePool.ended).toBe(true);
        expect(fixture.concurrentPool.ended).toBe(true);
        expect(fixture.fixturePool.ended).toBe(true);
        await assertAbsent(fixture.databaseName, fixture.roleName);
      } finally {
        await fixture.dispose();
      }
    }, 30000);
    it.each(["seed", "grant"] as const)(
      "cleans up after a %s setup failure without leaking driver diagnostics",
      async (phase) => {
        let databaseName = "";
        await expect(
          createTenantTestFixture({
            protectedTables:
              phase === "grant" ? ["missing_protected_table"] : ["church"],
            upgrade: {
              throughTag: "0002_user_profile",
              before: async (pool) => {
                databaseName = (
                  await pool.query("select current_database() db")
                ).rows[0].db;
                if (phase === "seed")
                  throw new Error("untrusted-driver-detail");
              },
            },
          }),
        ).rejects.toThrow("Tenant fixture setup failed");
        expect(databaseName).toMatch(/^tenant_test_[a-f0-9]{32}$/);
        await assertAbsent(
          databaseName,
          databaseName.replace("tenant_test_", "tenant_runtime_"),
        );
      },
      30000,
    );
    it.each([
      ["SUPERUSER", "NOSUPERUSER", "rolsuper"],
      ["BYPASSRLS", "NOBYPASSRLS", "rolbypassrls"],
      ["CREATEDB", "NOCREATEDB", "rolcreatedb"],
      ["CREATEROLE", "NOCREATEROLE", "rolcreaterole"],
    ])(
      "rejects an actual %s runtime role",
      async (unsafe, safe, flag) => {
        const fixture = await createTenantTestFixture({
          protectedTables: ["church", "church_membership"],
        });
        try {
          // Fixed test options and generated identifier only. Never execute protected probes while privileged.
          await fixture.fixturePool.query(
            'ALTER ROLE "' + fixture.roleName + '" ' + unsafe,
          );
          await expect(fixture.assertRestrictedRole()).rejects.toThrow(
            flag + " = false",
          );
          await fixture.fixturePool.query(
            'ALTER ROLE "' + fixture.roleName + '" ' + safe,
          );
          await fixture.assertRestrictedRole();
        } finally {
          await fixture.dispose();
        }
      },
      30000,
    );
  });
}
