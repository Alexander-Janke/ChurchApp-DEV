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
import { MembershipRepository } from "../../src/membership/membership.repository.js";
import { MembershipService } from "../../src/membership/membership.service.js";

export function membershipIntegrationTests() {
  describe("membership tenant isolation with a restricted PostgreSQL login", () => {
    const suffix = randomUUID().replaceAll("-", "");
    const databaseName = "membership_test_" + suffix;
    const roleName = "membership_runtime_" + suffix;
    // Ephemeral credentials remain in test memory, never logs/files.
    const rolePassword = randomBytes(32).toString("hex");
    const a = randomUUID(),
      b = randomUUID();
    const A = TenantContext.fromAuthorizedScope(a),
      B = TenantContext.fromAuthorizedScope(b);
    const ua = "fixture-user-a",
      ub = "fixture-user-b";
    const ma = randomUUID(),
      mb = randomUUID();
    let preserved = false;
    const folder = fileURLToPath(new URL("../../migrations", import.meta.url));
    let maintenance: Pool, owner: Pool, runtime: Pool, parallel: Pool;
    let db: DatabaseService,
      parallelDb: DatabaseService,
      tenants: TenantDatabase,
      service: MembershipService;
    let ownerDb: DatabaseService;
    let created = false,
      roleCreated = false;
    const repository = new MembershipRepository();
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
        journal.entries = journal.entries.slice(0, 4);
        writeFileSync(
          join(prior, "meta/_journal.json"),
          JSON.stringify(journal),
        );
        for (const name of [
          "0000_auth_foundation",
          "0001_email_change_workflow",
          "0002_user_profile",
          "0003_church_tenant_foundation",
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
        await owner.query(
          "INSERT INTO church(id,name,slug) VALUES ($1,'Preserved','preserved-church')",
          [a],
        );
        const preservationQuery =
          'SELECT row_to_json(u) u,row_to_json(p) p,row_to_json(e) e,row_to_json(c) c FROM "user" u JOIN user_profile p ON p.user_id=u.id JOIN email_change_request e ON e.user_id=u.id CROSS JOIN church c';
        const before = (await owner.query(preservationQuery)).rows;
        await migrate(drizzle(owner), { migrationsFolder: folder });
        expect((await owner.query(preservationQuery)).rows).toEqual(before);
        preserved = before.length === 1;
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
        `GRANT SELECT, INSERT, UPDATE, DELETE ON church, church_membership TO "${roleName}"`,
      );
      url.username = roleName;
      url.password = rolePassword;
      runtime = new Pool({ connectionString: url.toString(), max: 1 });
      parallel = new Pool({ connectionString: url.toString(), max: 2 });
      db = new DatabaseService(runtime);
      parallelDb = new DatabaseService(parallel);
      tenants = new TenantDatabase(db);
      service = new MembershipService(tenants, repository);
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
      await owner.query('DELETE FROM "user" WHERE id IN ($1,$2)', [ua, ub]);
      await owner.query(
        'INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
        [ua, "User A", "a@example.invalid", ub, "User B", "b@example.invalid"],
      );
      await owner.query(
        "INSERT INTO church(id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)",
        [a, "Church A", "church-a", b, "Church B", "church-b"],
      );
      await owner.query(
        "INSERT INTO church_membership(id,church_id,user_id,status) VALUES ($1,$2,$3,'member'),($4,$5,$6,'follower')",
        [ma, a, ua, mb, b, ub],
      );
    });

    const allRows = () =>
      owner.query("select * from church_membership order by id");
    async function noContext() {
      expect(
        (await runtime.query("select id from church_membership")).rows,
      ).toEqual([]);
      expect(
        (
          await runtime.query(
            "select nullif(current_setting('app.current_church_id',true),'') ctx",
          )
        ).rows[0].ctx,
      ).toBeNull();
      expect(runtime.waitingCount).toBe(0);
    }
    const broad = (context: TenantContext) =>
      tenants.transaction(context, (tx) =>
        tx.execute(sql`select id from church_membership order by id`),
      );
    it("migrates through 0004 preserving auth, profile, email-change and church data, and repeats without duplicating memberships", async () => {
      expect(preserved).toBe(true);
      const before = (await allRows()).rows;
      await migrate(drizzle(owner), { migrationsFolder: folder });
      expect((await allRows()).rows).toEqual(before);
      expect(
        (
          await owner.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(5);
    });
    it("uses a real restricted login without superuser, BYPASSRLS, owner membership or table ownership", async () => {
      const rows = (
        await runtime.query(
          "select current_user,session_user,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,pg_has_role(current_user,c.relowner,'MEMBER') owns from pg_roles cross join pg_class c where rolname=current_user and c.oid='church_membership'::regclass",
        )
      ).rows;
      expect(rows).toEqual([
        {
          current_user: roleName,
          session_user: roleName,
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          owns: false,
        },
      ]);
    });
    it("enables FORCE RLS and exactly one constrained USING/WITH CHECK policy", async () => {
      expect(
        (
          await runtime.query(
            "select relrowsecurity,relforcerowsecurity from pg_class where oid='church_membership'::regclass",
          )
        ).rows,
      ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      const policies = (
        await runtime.query(
          "select cmd,qual,with_check from pg_policies where tablename='church_membership'",
        )
      ).rows;
      expect(policies).toHaveLength(1);
      expect(policies[0].cmd).toBe("ALL");
      expect(policies[0].qual).toContain("church_id");
      expect(policies[0].qual).toContain("app.current_church_id");
      expect(policies[0].with_check).toBe(policies[0].qual);
    });
    it("rejects runtime operations if membership FORCE RLS is disabled", async () => {
      await owner.query(
        "ALTER TABLE church_membership NO FORCE ROW LEVEL SECURITY",
      );
      try {
        await expect(service.listRelationships(A)).rejects.toThrow(
          "Membership operation failed",
        );
      } finally {
        await owner.query(
          "ALTER TABLE church_membership FORCE ROW LEVEL SECURITY",
        );
      }
    });
    it("rejects runtime ownership of the membership table even when church ownership is restricted", async () => {
      await owner.query(`ALTER TABLE church_membership OWNER TO "${roleName}"`);
      try {
        await expect(service.listRelationships(A)).rejects.toThrow(
          "Membership operation failed",
        );
      } finally {
        const ownerName = (await owner.query("select current_user")).rows[0]
          .current_user as string;
        await owner.query(
          'ALTER TABLE church_membership OWNER TO "' +
            ownerName.replaceAll('"', '""') +
            '"',
        );
        // Ownership transfer removes the old owner's privileges; restore only test CRUD grants.
        await owner.query(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON church_membership TO "' +
            roleName +
            '"',
        );
      }
    });
    it("has six required columns, cascading FKs and unique pair/composite keys", async () => {
      const columns = (
        await runtime.query(
          "select column_name,is_nullable from information_schema.columns where table_name='church_membership' order by ordinal_position",
        )
      ).rows;
      expect(columns).toEqual(
        [
          "id",
          "church_id",
          "user_id",
          "status",
          "created_at",
          "updated_at",
        ].map((column_name) => ({ column_name, is_nullable: "NO" })),
      );
      const fks = (
        await runtime.query(
          "select confdeltype from pg_constraint where conrelid='church_membership'::regclass and contype='f'",
        )
      ).rows;
      expect(fks).toEqual([{ confdeltype: "c" }, { confdeltype: "c" }]);
      const indexes = (
        await runtime.query(
          "select indexname,indexdef from pg_indexes where tablename='church_membership'",
        )
      ).rows;
      expect(
        indexes.find((r) => r.indexname === "church_membership_church_user_idx")
          .indexdef,
      ).toContain("UNIQUE INDEX");
      expect(
        indexes.find((r) => r.indexname === "church_membership_church_id_idx")
          .indexdef,
      ).toContain("(church_id, id)");
    });
    it.each([
      [A, ma, ua],
      [B, mb, ub],
    ] as const)(
      "reads only its own relationship via ID, user selector and paginated list (%#)",
      async (context, id, userId) => {
        expect((await service.getRelationshipById(context, id))?.id).toBe(id);
        expect(
          (await service.getRelationshipForUser(context, userId))?.id,
        ).toBe(id);
        const rows = await service.listRelationships(context, 1);
        expect(rows.map((r) => r.id)).toEqual([id]);
        expect(await service.listRelationships(context, 1, id)).toEqual([]);
        expect(Object.keys(rows[0]!).sort()).toEqual(
          [
            "id",
            "churchId",
            "userId",
            "status",
            "createdAt",
            "updatedAt",
          ].sort(),
        );
      },
    );
    it("a deliberately broad raw SELECT under A returns only A", async () =>
      expect((await broad(A)).rows).toEqual([{ id: ma }]));
    it("missing or invalid context returns no membership rows", async () => {
      await noContext();
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.current_church_id','invalid',true)`,
        );
        expect(
          (await tx.execute(sql`select id from church_membership`)).rows,
        ).toEqual([]);
      });
    });
    it("rejects forged application scope before touching the database", async () => {
      await expect(
        service.listRelationships({ churchId: a } as TenantContext),
      ).rejects.toThrow("Trusted tenant context");
    });
    it("repository A plus RLS B discloses neither A nor B and mutates neither", async () => {
      const before = (await allRows()).rows;
      await tenants.transaction(B, async (tx) => {
        expect(await repository.getRelationshipById(A, tx, ma)).toBeNull();
        expect(await repository.getRelationshipById(A, tx, mb)).toBeNull();
        expect(await repository.getRelationshipForUser(A, tx, ua)).toBeNull();
        expect(await repository.listRelationships(A, tx)).toEqual([]);
        expect(
          await repository.changeRelationshipStatus(
            A,
            tx,
            ma,
            "member",
            "left",
          ),
        ).toBeNull();
        expect(
          await repository.changeRelationshipStatus(
            A,
            tx,
            mb,
            "follower",
            "left",
          ),
        ).toBeNull();
      });
      expect((await allRows()).rows).toEqual(before);
    });
    it("known foreign relationship/user IDs cannot select or mutate another tenant", async () => {
      expect(await service.getRelationshipById(A, mb)).toBeNull();
      expect(await service.getRelationshipForUser(A, ub)).toBeNull();
      expect(
        await service.changeRelationshipStatus(A, mb, "follower", "left"),
      ).toBeNull();
      expect((await service.getRelationshipById(B, mb))?.status).toBe(
        "follower",
      );
    });
    it("raw targeted update/delete cannot affect B from A", async () => {
      await tenants.transaction(A, async (tx) => {
        expect(
          (
            await tx.execute(
              sql`update church_membership set status='left' where id=${mb} returning id`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await tx.execute(
              sql`delete from church_membership where id=${mb} returning id`,
            )
          ).rows,
        ).toEqual([]);
      });
      expect((await service.getRelationshipById(B, mb))?.status).toBe(
        "follower",
      );
    });
    it("raw broad delete under A removes only A", async () => {
      await tenants.transaction(A, async (tx) =>
        expect(
          (await tx.execute(sql`delete from church_membership returning id`))
            .rows,
        ).toEqual([{ id: ma }]),
      );
      expect((await service.getRelationshipById(B, mb))?.id).toBe(mb);
    });
    it("normal creation derives ownership only from context and permits multi-church users", async () => {
      const created = await service.createRelationship(A, {
        userId: ub,
        status: "follower",
      });
      expect(created.outcome).toBe("created");
      if (created.outcome !== "created") throw new Error("Expected creation");
      expect(created.relationship.churchId).toBe(a);
      expect(created.relationship.userId).toBe(ub);
      expect(created.relationship.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await service.getRelationshipForUser(B, ub))?.id).toBe(mb);
      await expect(
        service.createRelationship(A, {
          userId: ub,
          status: "member",
          churchId: b,
        }),
      ).rejects.toThrow("Membership operation failed");
    });
    it("duplicate creation returns a safe outcome without changing the existing state", async () => {
      expect(
        await service.createRelationship(A, { userId: ua, status: "left" }),
      ).toEqual({ outcome: "already_exists" });
      expect((await service.getRelationshipById(A, ma))?.status).toBe("member");
    });
    it("concurrent duplicate creation produces exactly one row and one safe loser", async () => {
      const s = new MembershipService(
        new TenantDatabase(parallelDb),
        repository,
      );
      const results = await Promise.all([
        s.createRelationship(A, { userId: ub, status: "member" }),
        s.createRelationship(A, { userId: ub, status: "member" }),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual([
        "already_exists",
        "created",
      ]);
      expect(
        (await service.listRelationships(A)).filter((r) => r.userId === ub),
      ).toHaveLength(1);
    });
    it("database rejects raw duplicate pair creation", async () => {
      await expect(
        tenants.transaction(A, (tx) =>
          tx.execute(
            sql`insert into church_membership(id,church_id,user_id,status) values (${randomUUID()},${a},${ua},'member')`,
          ),
        ),
      ).rejects.toThrow();
      expect(await service.listRelationships(A)).toHaveLength(1);
    });
    it("required user FK rejects nonexistent global identity with sanitized service error", async () => {
      await expect(
        service.createRelationship(A, {
          userId: "nonexistent-user",
          status: "member",
        }),
      ).rejects.toThrow(/^Membership operation failed$/);
    });
    it("required church FK rejects nonexistent tenant even with matching context", async () => {
      const missing = TenantContext.fromAuthorizedScope(randomUUID());
      await expect(
        service.createRelationship(missing, { userId: ua, status: "member" }),
      ).rejects.toThrow(/^Membership operation failed$/);
    });
    it("WITH CHECK blocks raw insertion into B under A", async () => {
      await expect(
        tenants.transaction(A, (tx) =>
          tx.execute(
            sql`insert into church_membership(id,church_id,user_id,status) values (${randomUUID()},${b},${ua},'member')`,
          ),
        ),
      ).rejects.toThrow();
      expect(await service.listRelationships(B)).toHaveLength(1);
    });
    it("WITH CHECK blocks ownership rewrite from A to B", async () => {
      await expect(
        tenants.transaction(A, (tx) =>
          tx.execute(
            sql`update church_membership set church_id=${b} where id=${ma}`,
          ),
        ),
      ).rejects.toThrow();
      expect((await service.getRelationshipById(A, ma))?.churchId).toBe(a);
    });
    it("mismatched repository creation cannot override transaction ownership", async () => {
      await expect(
        tenants.transaction(B, (tx) =>
          repository.createRelationship(A, tx, {
            userId: ub,
            status: "member",
          }),
        ),
      ).rejects.toThrow();
      expect(await service.listRelationships(A)).toHaveLength(1);
    });
    it("missing context cannot insert", async () => {
      await expect(
        runtime.query(
          "insert into church_membership(id,church_id,user_id,status) values ($1,$2,$3,'member')",
          [randomUUID(), a, ub],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("missing context cannot update or delete", async () => {
      expect(
        (
          await runtime.query(
            "update church_membership set status='left' returning id",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await runtime.query("delete from church_membership returning id"))
          .rows,
      ).toEqual([]);
      expect((await allRows()).rows).toHaveLength(2);
    });
    it.each(["admin", "owner", "Member", "pending"])(
      "database status check rejects %s",
      async (status) => {
        await expect(
          tenants.transaction(A, (tx) =>
            tx.execute(
              sql`update church_membership set status=${status} where id=${ma}`,
            ),
          ),
        ).rejects.toThrow();
      },
    );
    it("state transitions retain ID/creation time and update timestamp without affecting B", async () => {
      const original = await service.getRelationshipById(A, ma);
      for (const [from, to] of [
        ["member", "inactive"],
        ["inactive", "left"],
        ["left", "follower"],
        ["follower", "member"],
      ]) {
        const row = await service.changeRelationshipStatus(A, ma, from, to);
        expect(row?.id).toBe(ma);
        expect(row?.createdAt).toEqual(original?.createdAt);
        expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(
          original!.updatedAt.getTime(),
        );
        expect(row?.status).toBe(to);
      }
      expect((await service.getRelationshipById(B, mb))?.status).toBe(
        "follower",
      );
    });
    it("concurrent transitions use expected-state matching without losing row identity", async () => {
      const s = new MembershipService(
        new TenantDatabase(parallelDb),
        repository,
      );
      const results = await Promise.all([
        s.changeRelationshipStatus(A, ma, "member", "inactive"),
        s.changeRelationshipStatus(A, ma, "member", "left"),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await service.getRelationshipById(A, ma))?.id).toBe(ma);
      expect(
        await s.changeRelationshipStatus(A, ma, "member", "follower"),
      ).toBeNull();
    });
    it("deleting a global user cascades only their relationships", async () => {
      // Privileged identity deletion is fixture work, not a claimed RLS assertion.
      await owner.query('DELETE FROM "user" WHERE id=$1', [ua]);
      expect(await service.getRelationshipById(A, ma)).toBeNull();
      expect((await service.getRelationshipById(B, mb))?.id).toBe(mb);
    });
    it("deleting a church cascades only that tenant's relationships", async () => {
      await tenants.transaction(A, (tx) =>
        tx.execute(sql`delete from church where id=${a}`),
      );
      expect(await service.getRelationshipById(A, ma)).toBeNull();
      expect((await service.getRelationshipById(B, mb))?.id).toBe(mb);
    });
    it("commit clears context on the exact reused connection", async () => {
      const pid = await tenants.transaction(A, async (tx) => {
        expect(
          (await repository.listRelationships(A, tx)).map((r) => r.id),
        ).toEqual([ma]);
        return (await tx.execute(sql`select pg_backend_pid() pid`)).rows[0]
          ?.pid;
      });
      expect(
        (await runtime.query("select pg_backend_pid() pid")).rows[0].pid,
      ).toBe(pid);
      await noContext();
    });
    it("rollback clears membership context on the same borrowed connection", async () => {
      const client = await runtime.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "select set_config('app.current_church_id',$1,true)",
          [a],
        );
        expect(
          (await client.query("select id from church_membership")).rows,
        ).toEqual([{ id: ma }]);
        await client.query("ROLLBACK");
        expect(
          (await client.query("select id from church_membership")).rows,
        ).toEqual([]);
      } finally {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
      await noContext();
    });
    it("application error rolls back status writes and leaves the pool unscoped", async () => {
      await expect(
        tenants.transaction(A, async (tx) => {
          await repository.changeRelationshipStatus(
            A,
            tx,
            ma,
            "member",
            "left",
          );
          throw new Error("intentional rollback");
        }),
      ).rejects.toThrow("intentional rollback");
      expect((await service.getRelationshipById(A, ma))?.status).toBe("member");
      await noContext();
    });
    it("SQL error rolls back status writes and releases/discards connection safely", async () => {
      await expect(
        tenants.transaction(A, async (tx) => {
          await repository.changeRelationshipStatus(
            A,
            tx,
            ma,
            "member",
            "left",
          );
          await tx.execute(sql`select 1/0`);
        }),
      ).rejects.toThrow();
      expect((await service.getRelationshipById(A, ma))?.status).toBe("member");
      await noContext();
      expect(runtime.idleCount).toBe(runtime.totalCount);
    });
    it("concurrent A/B transactions preserve separate contexts and pooled cleanup", async () => {
      let arrived = 0;
      let release!: () => void;
      const both = new Promise<void>((resolve) => {
        release = resolve;
      });
      const boundary = new TenantDatabase(parallelDb);
      const run = (ctx: TenantContext) =>
        boundary.transaction(ctx, async (tx) => {
          if (++arrived === 2) release();
          await both;
          return {
            pid: (await tx.execute(sql`select pg_backend_pid() pid`)).rows[0]
              ?.pid,
            rows: (await tx.execute(sql`select id from church_membership`))
              .rows,
          };
        });
      const [one, two] = await Promise.all([run(A), run(B)]);
      expect(one.pid).not.toBe(two.pid);
      expect(one.rows).toEqual([{ id: ma }]);
      expect(two.rows).toEqual([{ id: mb }]);
      const clients = await Promise.all([
        parallel.connect(),
        parallel.connect(),
      ]);
      try {
        for (const c of clients)
          expect(
            (await c.query("select id from church_membership")).rows,
          ).toEqual([]);
      } finally {
        clients.forEach((c) => c.release());
      }
    });
    it("runtime cannot TRUNCATE or disable membership RLS", async () => {
      await expect(
        runtime.query("TRUNCATE church_membership"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        runtime.query(
          "ALTER TABLE church_membership DISABLE ROW LEVEL SECURITY",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
}
