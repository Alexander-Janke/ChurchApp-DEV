import "reflect-metadata";
import { randomUUID, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { getDatabaseUrl } from "../../src/database/database.config.js";
import { DatabaseService } from "../../src/database/database.service.js";
import { TenantDatabase } from "../../src/database/tenant-database.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import { ChurchRepository } from "../../src/church/church.repository.js";
import { ChurchService } from "../../src/church/church.service.js";

export function churchIntegrationTests() {
  describe("church tenant isolation with a restricted PostgreSQL login", () => {
    const suffix = randomUUID().replaceAll("-", "");
    const databaseName = "church_test_" + suffix;
    const roleName = "church_runtime_" + suffix;
    // Ephemeral credentials remain in test memory, never logs/files.
    const rolePassword = randomBytes(32).toString("hex");
    const a = randomUUID(),
      b = randomUUID();
    const A = TenantContext.fromAuthorizedScope(a),
      B = TenantContext.fromAuthorizedScope(b);
    const folder = fileURLToPath(new URL("../../migrations", import.meta.url));
    let maintenance: Pool, owner: Pool, runtime: Pool, parallel: Pool;
    let db: DatabaseService,
      parallelDb: DatabaseService,
      tenants: TenantDatabase,
      service: ChurchService;
    let ownerDb: DatabaseService;
    let created = false,
      roleCreated = false;
    const repository = new ChurchRepository();
    beforeAll(async () => {
      const url = new URL(getDatabaseUrl());
      maintenance = new Pool({ connectionString: url.toString() });
      await maintenance.query(
        `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
      );
      created = true;
      url.pathname = "/" + databaseName;
      owner = new Pool({ connectionString: url.toString() });
      ownerDb = new DatabaseService(owner);
      // Upgrade a representative prior schema and preserve existing non-tenant data.
      const cache = fileURLToPath(
        new URL("../../../../.cache/", import.meta.url),
      );
      mkdirSync(cache, { recursive: true });
      const prior = mkdtempSync(join(cache, "church-prior-migrations-"));
      try {
        mkdirSync(join(prior, "meta"));
        const journal = JSON.parse(
          readFileSync(join(folder, "meta/_journal.json"), "utf8"),
        );
        journal.entries = journal.entries.slice(0, 3);
        writeFileSync(
          join(prior, "meta/_journal.json"),
          JSON.stringify(journal),
        );
        for (const name of [
          "0000_auth_foundation",
          "0001_email_change_workflow",
          "0002_user_profile",
        ])
          copyFileSync(join(folder, name + ".sql"), join(prior, name + ".sql"));
        await migrate(drizzle(owner), { migrationsFolder: prior });
        await owner.query(
          'INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3)',
          ["existing-user", "Existing", "existing@example.invalid"],
        );
        await owner.query(
          "INSERT INTO user_profile(user_id,username) VALUES ($1,$2)",
          ["existing-user", "existing-profile"],
        );
        await owner.query(
          "INSERT INTO email_change_request(id,user_id,initiating_session_id,current_email,new_email,status,expires_at,created_at,updated_at) VALUES ('existing-workflow','existing-user','snapshot','existing@example.invalid','next@example.invalid','superseded',now(),now(),now())",
        );
        await migrate(drizzle(owner), { migrationsFolder: folder });
      } finally {
        const local = relative(resolve(cache), resolve(prior));
        if (
          !local.startsWith("church-prior-migrations-") ||
          local.includes("..") ||
          local.includes("/") ||
          local.includes("\\")
        )
          throw new Error("Unsafe fixture cleanup path");
        rmSync(prior, { recursive: true });
      }
      // DDL identifiers/password come exclusively from generated UUID/hex values.
      await maintenance.query(
        `CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
      );
      roleCreated = true;
      await owner.query(
        `GRANT CONNECT ON DATABASE "${databaseName}" TO "${roleName}"`,
      );
      await owner.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
      await owner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON church TO "${roleName}"`,
      );
      url.username = roleName;
      url.password = rolePassword;
      runtime = new Pool({ connectionString: url.toString(), max: 1 });
      parallel = new Pool({ connectionString: url.toString(), max: 2 });
      db = new DatabaseService(runtime);
      parallelDb = new DatabaseService(parallel);
      tenants = new TenantDatabase(db);
      service = new ChurchService(tenants, repository);
      // A real login, not a superuser connection with a mocked role.
      const role = (
        await runtime.query(
          "select current_user,session_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user",
        )
      ).rows[0];
      expect(role).toEqual({
        current_user: roleName,
        session_user: roleName,
        rolsuper: false,
        rolbypassrls: false,
      });
    }, 30000);
    afterAll(async () => {
      try {
        await parallelDb?.onModuleDestroy();
        await db?.onModuleDestroy();
        await ownerDb?.onModuleDestroy();
      } finally {
        try {
          if (created)
            await maintenance.query(`DROP DATABASE "${databaseName}"`);
          if (roleCreated) await maintenance.query(`DROP ROLE "${roleName}"`);
        } finally {
          await maintenance?.end();
        }
      }
    });
    beforeEach(async () => {
      await owner.query("TRUNCATE church CASCADE");
      await owner.query(
        "INSERT INTO church(id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)",
        [a, "Church A", "church-a", b, "Church B", "church-b"],
      );
    });
    const broad = (context: TenantContext) =>
      tenants.transaction(context, (tx) =>
        tx.execute(sql`select id from church order by id`),
      );
    const details = (name = "Updated A") => ({ name, slug: "church-a" });
    async function untouched() {
      expect(
        (await owner.query("select id,name from church order by id")).rows,
      ).toEqual(
        [
          { id: a, name: "Church A" },
          { id: b, name: "Church B" },
        ].sort((x, y) => x.id.localeCompare(y.id)),
      );
    }
    it("applies 0000 through 0004 and repeats without altering existing identity/profile/email-change data", async () => {
      const before = (
        await owner.query(
          'SELECT row_to_json(u) u, row_to_json(p) p, row_to_json(e) e FROM "user" u JOIN user_profile p ON p.user_id=u.id JOIN email_change_request e ON e.user_id=u.id',
        )
      ).rows;
      expect(before).toHaveLength(1);
      expect(before[0].p.username).toBe("existing-profile");
      await migrate(drizzle(owner), { migrationsFolder: folder });
      expect(
        (
          await owner.query(
            'SELECT row_to_json(u) u, row_to_json(p) p, row_to_json(e) e FROM "user" u JOIN user_profile p ON p.user_id=u.id JOIN email_change_request e ON e.user_id=u.id',
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await owner.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(5);
    });
    it("runs protected assertions under a non-owner login without superuser, BYPASSRLS or role-creation privileges", async () => {
      const r = (
        await runtime.query(
          "select current_user, session_user, rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,pg_has_role(current_user,c.relowner,'MEMBER') owns from pg_roles cross join pg_class c where rolname=current_user and c.oid='church'::regclass",
        )
      ).rows[0];
      expect(r).toEqual({
        current_user: roleName,
        session_user: roleName,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        owns: false,
      });
    });
    it("enables and forces RLS with matching USING and WITH CHECK", async () => {
      const r = (
        await runtime.query(
          "select relrowsecurity,relforcerowsecurity from pg_class where oid='church'::regclass",
        )
      ).rows[0];
      expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const p = (
        await runtime.query(
          "select cmd,qual,with_check from pg_policies where tablename='church'",
        )
      ).rows;
      expect(p).toHaveLength(1);
      expect(p[0].cmd).toBe("ALL");
      expect(p[0].qual).toContain("app.current_church_id");
      expect(p[0].with_check).toBe(p[0].qual);
    });
    it("rejects migration/superuser credentials at the tenant transaction boundary", async () => {
      await expect(
        new TenantDatabase(ownerDb).transaction(A, (tx) =>
          tx.execute(sql`select id from church`),
        ),
      ).rejects.toThrow("Restricted tenant database role");
    });
    it.each([
      [A, a],
      [B, b],
    ] as const)(
      "reads only the explicitly scoped current church (%#)",
      async (context, id) => {
        expect((await service.getCurrentChurch(context))?.id).toBe(id);
        expect((await broad(context)).rows).toEqual([{ id }]);
      },
    );
    it("missing or invalid raw database context reads no churches", async () => {
      expect((await runtime.query("select id from church")).rows).toEqual([]);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.current_church_id','invalid',true)`,
        );
        expect((await tx.execute(sql`select id from church`)).rows).toEqual([]);
      });
    });
    it("missing trusted application context rejects before queries", async () => {
      await expect(
        service.getCurrentChurch({ churchId: a } as TenantContext),
      ).rejects.toThrow("Trusted tenant context");
    });
    it("repository A under RLS B reads and changes neither", async () => {
      await tenants.transaction(B, async (tx) => {
        expect(await repository.getCurrentChurch(A, tx)).toBeNull();
        expect(
          await repository.updateCurrentChurch(A, tx, details()),
        ).toBeNull();
      });
      await untouched();
    });
    it.each([
      [A, b],
      [B, a],
    ] as const)(
      "cannot update the other tenant (%#)",
      async (context, other) => {
        await tenants.transaction(context, async (tx) => {
          expect(
            (
              await tx.execute(
                sql`update church set name='Forbidden' where id=${other} returning id`,
              )
            ).rows,
          ).toEqual([]);
        });
        await untouched();
      },
    );
    it("updates current church through explicit repository without touching B", async () => {
      const row = await service.updateCurrentChurch(A, details());
      expect(row?.name).toBe("Updated A");
      expect((await service.getCurrentChurch(B))?.name).toBe("Church B");
    });
    it("missing context cannot update or delete protected rows", async () => {
      expect(
        (await runtime.query("update church set name='Forbidden' returning id"))
          .rows,
      ).toEqual([]);
      expect(
        (await runtime.query("delete from church returning id")).rows,
      ).toEqual([]);
      await untouched();
    });
    it("missing context rejects inserts rather than creating an unscoped root", async () => {
      await expect(
        runtime.query("insert into church(id,name,slug) values ($1,$2,$3)", [
          randomUUID(),
          "Blocked",
          "blocked-root",
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await untouched();
    });
    it("WITH CHECK rejects insertion for another tenant", async () => {
      await expect(
        tenants.transaction(A, (tx) =>
          tx.execute(
            sql`insert into church(id,name,slug) values (${randomUUID()},'Foreign','foreign-church')`,
          ),
        ),
      ).rejects.toThrow();
      await untouched();
    });
    it("WITH CHECK rejects changing the root ID to another scope", async () => {
      await expect(
        tenants.transaction(A, (tx) =>
          tx.execute(sql`update church set id=${randomUUID()} where id=${a}`),
        ),
      ).rejects.toThrow();
      await untouched();
    });
    it("repository refuses protected ID and verification-state mutation", async () => {
      await expect(
        service.updateCurrentChurch(A, { ...details(), id: b }),
      ).rejects.toThrow("Invalid church details");
      await expect(
        service.updateCurrentChurch(A, {
          ...details(),
          verificationState: "verified",
        }),
      ).rejects.toThrow("Invalid church details");
      await untouched();
    });
    it("raw broad delete under A cannot delete B", async () => {
      await tenants.transaction(A, async (tx) => {
        expect(
          (await tx.execute(sql`delete from church returning id`)).rows,
        ).toEqual([{ id: a }]);
      });
      expect((await service.getCurrentChurch(B))?.id).toBe(b);
    });
    it("runtime has no TRUNCATE privilege (which would bypass row filtering)", async () => {
      await expect(runtime.query("TRUNCATE church")).rejects.toMatchObject({
        code: "42501",
      });
      await untouched();
    });
    it("runtime cannot disable RLS", async () => {
      await expect(
        runtime.query("ALTER TABLE church DISABLE ROW LEVEL SECURITY"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("commit clears context on the exact same pooled connection", async () => {
      const pid = await tenants.transaction(A, async (tx) => {
        expect((await tx.execute(sql`select id from church`)).rows).toEqual([
          { id: a },
        ]);
        return (await tx.execute(sql`select pg_backend_pid() pid`)).rows[0]
          ?.pid;
      });
      const next = (
        await runtime.query(
          "select pg_backend_pid() pid,nullif(current_setting('app.current_church_id',true),'') ctx",
        )
      ).rows[0];
      expect(next).toEqual({ pid, ctx: null });
      expect((await runtime.query("select id from church")).rows).toEqual([]);
    });
    it("rollback clears local context on a reused connection", async () => {
      const client = await runtime.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "select set_config('app.current_church_id',$1,true)",
          [a],
        );
        expect((await client.query("select id from church")).rows).toEqual([
          { id: a },
        ]);
        await client.query("ROLLBACK");
        expect((await client.query("select id from church")).rows).toEqual([]);
        expect(
          (
            await client.query(
              "select nullif(current_setting('app.current_church_id',true),'') ctx",
            )
          ).rows[0].ctx,
        ).toBeNull();
      } finally {
        client.release();
      }
    });
    it("thrown callback error rolls back writes and leaves no context", async () => {
      await expect(
        tenants.transaction(A, async (tx) => {
          await repository.updateCurrentChurch(A, tx, details());
          throw new Error("intentional tenant rollback");
        }),
      ).rejects.toThrow("intentional tenant rollback");
      await untouched();
      expect((await runtime.query("select id from church")).rows).toEqual([]);
      expect(runtime.waitingCount).toBe(0);
    });
    it("database error leaves no context or borrowed client", async () => {
      await expect(
        tenants.transaction(A, (tx) => tx.execute(sql`select 1/0`)),
      ).rejects.toThrow();
      expect((await runtime.query("select id from church")).rows).toEqual([]);
      expect(runtime.idleCount).toBe(runtime.totalCount);
    });
    it("concurrent A/B transactions have separate connections and contexts", async () => {
      let arrived = 0;
      let release!: () => void;
      const both = new Promise<void>((resolve) => {
        release = resolve;
      });
      const boundary = new TenantDatabase(parallelDb);
      const run = (context: TenantContext) =>
        boundary.transaction(context, async (tx) => {
          arrived++;
          if (arrived === 2) release();
          await both;
          const pid = (await tx.execute(sql`select pg_backend_pid() pid`))
            .rows[0]?.pid;
          return {
            pid,
            rows: (await tx.execute(sql`select id from church`)).rows,
          };
        });
      const [first, second] = await Promise.all([run(A), run(B)]);
      expect(first.pid).not.toBe(second.pid);
      expect(first.rows).toEqual([{ id: a }]);
      expect(second.rows).toEqual([{ id: b }]);
      expect((await parallel.query("select id from church")).rows).toEqual([]);
    });
    it("repository predicate independently limits reads/writes even with an owner fixture connection", async () => {
      // Explicitly NOT an RLS assertion; verifies the independent WHERE layer.
      await ownerDb.transaction(async (tx) => {
        expect((await repository.getCurrentChurch(A, tx))?.id).toBe(a);
        await repository.updateCurrentChurch(A, tx, details());
      });
      expect(
        (await owner.query("select name from church where id=$1", [b])).rows[0]
          .name,
      ).toBe("Church B");
    });
    it("canonical slug uniqueness blocks conflicting updates", async () => {
      await expect(
        service.updateCurrentChurch(B, { name: "B", slug: "CHURCH-A" }),
      ).rejects.toThrow();
      await untouched();
    });
    it.each([
      ["slug", "UPPER"],
      ["slug", "ab"],
      ["slug", "x".repeat(64)],
      ["status", "deleted"],
      ["verification_state", "approved"],
      ["country_code", "de"],
      ["name", " "],
    ])("database rejects invalid %s (%#)", async (column, value) => {
      // Column comes only from the fixed test list, not external input.
      await expect(
        owner.query(`update church set "${column}"=$1 where id=$2`, [value, a]),
      ).rejects.toThrow();
    });
    it("defaults distinguish lifecycle from verification state", async () => {
      const row = await service.getCurrentChurch(A);
      expect(row?.status).toBe("active");
      expect(row?.verificationState).toBe("unverified");
      expect(row?.createdAt).toBeInstanceOf(Date);
    });
  });
}
