import type { Pool } from "pg";

// Identifiers are test configuration, never request data. No qualified/wildcard names.
export function tableIdentifiers(tables: readonly string[]): string[] {
  if (
    !tables.length ||
    new Set(tables).size !== tables.length ||
    tables.some((name) => !/^[a-z][a-z0-9_]{0,62}$/.test(name))
  ) {
    throw new Error(
      "Tenant fixture requires distinct plain protected table names",
    );
  }
  return tables.map((name) => '"' + name + '"');
}

export function assertDisposableNames(
  databaseName: string,
  roleName: string,
): void {
  const match = /^tenant_test_([a-f0-9]{32})$/.exec(databaseName);
  if (!match || roleName !== "tenant_runtime_" + match[1]) {
    throw new Error("Refusing non-disposable tenant fixture target");
  }
}

export interface RuntimeRole {
  current_user: string;
  session_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
}
export function assertRoleFlags(role: RuntimeRole, expectedRole: string): void {
  if (
    role.current_user !== expectedRole ||
    role.session_user !== expectedRole
  ) {
    throw new Error("Tenant runtime must use its own restricted LOGIN role");
  }
  for (const flag of [
    "rolsuper",
    "rolbypassrls",
    "rolcreatedb",
    "rolcreaterole",
  ] as const) {
    if (role[flag] !== false)
      throw new Error("Tenant runtime must have " + flag + " = false");
  }
}

export async function assertRestrictedRole(
  pool: Pool,
  tables: readonly string[],
  expectedRole: string,
): Promise<void> {
  tableIdentifiers(tables);
  const role = (
    await pool.query<RuntimeRole>(
      "select current_user,session_user,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user",
    )
  ).rows[0];
  if (!role) throw new Error("Tenant runtime role was not found");
  assertRoleFlags(role, expectedRole);
  for (const table of tables) {
    const row = (
      await pool.query(
        "select pg_has_role(current_user,c.relowner,'MEMBER') owns,c.relrowsecurity enabled,c.relforcerowsecurity forced from pg_class c where c.oid=to_regclass($1)",
        ["public." + table],
      )
    ).rows[0];
    if (!row) throw new Error("Protected table missing: " + table);
    if (row.owns !== false)
      throw new Error("Tenant runtime owns or can assume owner of " + table);
    if (row.enabled !== true || row.forced !== true)
      throw new Error("Protected table requires ENABLE/FORCE RLS: " + table);
  }
}

export async function grantRuntimeTables(
  fixturePool: Pool,
  databaseName: string,
  roleName: string,
  tables: readonly string[],
): Promise<void> {
  assertDisposableNames(databaseName, roleName);
  const names = tableIdentifiers(tables);
  // Only CONNECT, schema USAGE, and named-table CRUD. No CREATE, TRUNCATE,
  // owner membership, ALL TABLES or sequence grants (current IDs are UUIDs).
  await fixturePool.query(
    `GRANT CONNECT ON DATABASE "${databaseName}" TO "${roleName}"`,
  );
  await fixturePool.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
  await fixturePool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${names.join(", ")} TO "${roleName}"`,
  );
}
