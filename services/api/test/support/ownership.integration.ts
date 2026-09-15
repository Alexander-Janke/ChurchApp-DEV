import { randomUUID, randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { OwnershipService } from "../../src/ownership/ownership.service.js";
import { OwnershipRepository } from "../../src/ownership/ownership.repository.js";
import { SessionAssuranceService } from "../../src/auth/session-assurance.service.js";
import { AssurancePolicy } from "../../src/auth/assurance-policy.js";
import { MembershipRepository } from "../../src/membership/membership.repository.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import { migrateFixture } from "./tenant/migration-fixture.js";

export function ownershipIntegrationTests() {
  describe("Primary Owner atomic audit through restricted tenant RLS", () => {
    const base = baseTenantFixtures(),
      A = base.tenantA.context,
      B = base.tenantB.context;
    const alice = {
      userId: base.userA.userId,
      sessionId: randomUUID(),
      membershipId: base.relationshipA.id,
    };
    const outside = {
      userId: base.userB.userId,
      sessionId: randomUUID(),
      membershipId: base.relationshipB.id,
    };
    const bob = {
      userId: randomUUID(),
      sessionId: randomUUID(),
      membershipId: randomUUID(),
    };
    const carol = {
      userId: randomUUID(),
      sessionId: randomUUID(),
      membershipId: randomUUID(),
    };
    const people = [alice, bob, carol, outside];
    const subject = (p = alice) => ({
      userId: p.userId,
      sessionId: p.sessionId,
    });
    const repo = new OwnershipRepository(),
      memberships = new MembershipRepository();
    let f: TenantTestFixture,
      service: OwnershipService,
      concurrent: OwnershipService,
      now: number;
    const tables = [
      "church",
      "church_membership",
      "church_role",
      "church_role_permission",
      "church_membership_role",
      "church_primary_owner",
      "church_ownership_audit",
    ];
    beforeAll(async () => {
      f = await createTenantTestFixture({ protectedTables: tables });
      // Exact non-secret reads and ID-only row-lock privilege; no secret-column
      // SELECT or blanket auth-table grant. This is disposable fixture configuration.
      for (const [table, columns, id] of [
        ['"user"', "id,two_factor_enabled", "id"],
        ["two_factor", "user_id,verified", "id"],
        ["session", "id,user_id,created_at,expires_at", "id"],
        [
          "session_assurance",
          "session_id,elevated_at,last_elevated_activity_at,step_up_at",
          "session_id",
        ],
      ])
        await f.fixturePool.query(
          `GRANT SELECT(${columns}), UPDATE(${id}) ON ${table} TO "${f.roleName}"`,
        );
      service = new OwnershipService(
        f.tenantDatabase,
        repo,
        new SessionAssuranceService(
          f.runtimeDb,
          new AssurancePolicy(() => now),
        ),
      );
      concurrent = new OwnershipService(
        f.concurrentTenantDatabase,
        repo,
        new SessionAssuranceService(
          f.concurrentDb,
          new AssurancePolicy(() => now),
        ),
      );
    }, 30000);
    afterAll(async () => {
      await f?.dispose();
    });
    beforeEach(async () => {
      now = Date.now();
      await seedTenantFixtures(f.fixturePool, base, { memberships: true });
      await f.fixturePool.query(
        'DELETE FROM "user" WHERE id = ANY($1::text[])',
        [[bob.userId, carol.userId]],
      );
      for (const p of [bob, carol]) {
        await f.fixturePool.query(
          'INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
          [p.userId, "Ownership fixture", p.userId + "@example.invalid"],
        );
        await f.fixturePool.query(
          "INSERT INTO church_membership(id,church_id,user_id,status) VALUES($1,$2,$3,'member')",
          [p.membershipId, A.churchId, p.userId],
        );
      }
      await f.fixturePool.query(
        "UPDATE church_membership SET status='member' WHERE id=$1",
        [outside.membershipId],
      );
      // Structural auth/assurance fixtures only, as in Task 1.15 tenant tests.
      // Real native factor issuance remains covered by the unchanged auth suite.
      for (const p of people) {
        await f.fixturePool.query(
          'UPDATE "user" SET two_factor_enabled=true WHERE id=$1',
          [p.userId],
        );
        await f.fixturePool.query(
          "INSERT INTO two_factor(id,user_id,secret,backup_codes,verified) VALUES($1,$2,$3,$4,true)",
          [
            randomUUID(),
            p.userId,
            randomBytes(48).toString("hex"),
            randomBytes(48).toString("hex"),
          ],
        );
        await f.fixturePool.query(
          "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)",
          [
            p.sessionId,
            p.userId,
            randomBytes(32).toString("hex"),
            new Date(now - 60000).toISOString(),
            new Date(now + 86400000).toISOString(),
          ],
        );
        await proof(p);
      }
    });
    async function proof(p = alice) {
      await f.fixturePool.query(
        "INSERT INTO session_assurance(session_id,elevated_at,last_elevated_activity_at,step_up_at) VALUES($1,$2,$2,$2) ON CONFLICT(session_id) DO UPDATE SET elevated_at=$2,last_elevated_activity_at=$2,step_up_at=$2",
        [p.sessionId, new Date(now).toISOString()],
      );
    }
    const establish = (p = alice, ctx = A, s = service) =>
      s.establishInitialOwner(ctx, subject(p), p.membershipId);
    const transfer = (p = bob, actor = alice, s = service) =>
      s.transferPrimaryOwner(A, subject(actor), p.membershipId);
    const owner = (ctx = A) => f.withTenant(ctx, (tx) => repo.current(ctx, tx));
    const audits = (ctx = A) =>
      f.withTenant(ctx, (tx) => repo.recentAudit(ctx, tx));
    const status = (p: typeof alice, expected: string, next: string) =>
      f.withTenant(p === outside ? B : A, (tx) =>
        memberships.changeRelationshipStatus(
          p === outside ? B : A,
          tx,
          p.membershipId,
          expected,
          next,
        ),
      );

    it("clean/repeat migrations end at 0010 and leave ownerless churches valid", async () => {
      await f.assertRestrictedRole();
      expect(await owner()).toBeNull();
      const before = await f.fixturePool.query(
        "select hash from drizzle.__drizzle_migrations order by id",
      );
      expect(before.rows).toHaveLength(12);
      await migrateFixture(f.fixturePool);
      expect(
        (
          await f.fixturePool.query(
            "select hash from drizzle.__drizzle_migrations order by id",
          )
        ).rows,
      ).toEqual(before.rows);
      expect(await owner()).toBeNull();
    });
    it("self-establishment requires a server-resolved authenticated recipient and writes exactly one audit", async () => {
      expect(await establish()).toBe("changed");
      const records = await audits();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        churchId: A.churchId,
        eventType: "initial_owner_established",
        previousOwnerMembershipId: null,
        newOwnerMembershipId: alice.membershipId,
        actorUserId: alice.userId,
        actorSessionId: alice.sessionId,
      });
      expect(await service.isPrimaryOwner(A, subject())).toBe(true);
      expect(await service.isPrimaryOwner(A, subject(bob))).toBe(false);
    });
    it("rejects establishing for another identity even with a real current session", async () => {
      expect(
        await service.establishInitialOwner(A, subject(), bob.membershipId),
      ).toBe("denied");
      expect(await audits()).toHaveLength(0);
    });
    it("second initial owner conflicts without a misleading audit", async () => {
      expect(await establish()).toBe("changed");
      expect(await establish(bob)).toBe("conflict");
      expect(await audits()).toHaveLength(1);
    });
    it("concurrent initial establishment has exactly one owner and one event", async () => {
      const results = await Promise.all([
        establish(alice, A, concurrent),
        establish(bob, A, concurrent),
      ]);
      expect(results.filter((r) => r === "changed")).toHaveLength(1);
      expect(results.filter((r) => r === "conflict")).toHaveLength(1);
      expect(await audits()).toHaveLength(1);
      expect([alice.membershipId, bob.membershipId]).toContain(
        (await owner())!.membershipId,
      );
    });
    it.each(["follower", "inactive", "left"])(
      "initial owner cannot be %s",
      async (state) => {
        await status(alice, "member", state);
        expect(await establish()).toBe("denied");
        expect(await owner()).toBeNull();
        expect(await audits()).toHaveLength(0);
      },
    );
    it.each(["disabled", "unverified", "absent"])(
      "initial owner requires real stored factor eligibility: %s",
      async (kind) => {
        if (kind === "disabled")
          await f.fixturePool.query(
            'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
            [alice.userId],
          );
        if (kind === "unverified")
          await f.fixturePool.query(
            "UPDATE two_factor SET verified=false WHERE user_id=$1",
            [alice.userId],
          );
        if (kind === "absent")
          await f.fixturePool.query("DELETE FROM two_factor WHERE user_id=$1", [
            alice.userId,
          ]);
        expect(await establish()).toBe("denied");
        expect(await audits()).toHaveLength(0);
      },
    );
    it("rejects missing/revoked/foreign sessions before establishment", async () => {
      expect(
        await service.establishInitialOwner(
          A,
          { userId: alice.userId, sessionId: bob.sessionId },
          alice.membershipId,
        ),
      ).toBe("denied");
      await f.fixturePool.query("DELETE FROM session WHERE id=$1", [
        alice.sessionId,
      ]);
      expect(await establish()).toBe("denied");
      expect(await audits()).toHaveLength(0);
    });
    it("initial establishment does not invent elevated proof", async () => {
      await f.fixturePool.query(
        "DELETE FROM session_assurance WHERE session_id=$1",
        [alice.sessionId],
      );
      expect(await establish()).toBe("changed");
      expect(
        (
          await f.fixturePool.query(
            "SELECT session_id FROM session_assurance WHERE session_id=$1",
            [alice.sessionId],
          )
        ).rows,
      ).toHaveLength(0);
    });
    it("atomic transfer records exact before/after and revokes old ownership immediately", async () => {
      await establish();
      expect(await transfer()).toBe("changed");
      expect((await owner())!.membershipId).toBe(bob.membershipId);
      expect(await service.isPrimaryOwner(A, subject())).toBe(false);
      expect(await service.isPrimaryOwner(A, subject(bob))).toBe(true);
      const events = (await audits()).filter(
        (r) => r.eventType === "ownership_transferred",
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        previousOwnerMembershipId: alice.membershipId,
        newOwnerMembershipId: bob.membershipId,
        actorUserId: alice.userId,
        actorSessionId: alice.sessionId,
      });
    });
    it("self-transfer is unchanged with unchanged timestamps and no extra audit", async () => {
      await establish();
      const before = await owner();
      expect(await transfer(alice)).toBe("unchanged");
      expect(await owner()).toEqual(before);
      expect(await audits()).toHaveLength(1);
    });
    it("concurrent A to B/C has one winner and exactly one matching transfer audit", async () => {
      await establish();
      const results = await Promise.all([
        transfer(bob, alice, concurrent),
        transfer(carol, alice, concurrent),
      ]);
      expect(results.filter((r) => r === "changed")).toHaveLength(1);
      expect(results.filter((r) => r === "conflict")).toHaveLength(1);
      const events = (await audits()).filter(
        (r) => r.eventType === "ownership_transferred",
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.newOwnerMembershipId).toBe(
        (await owner())!.membershipId,
      );
    });
    it("stale former owner cannot overwrite or emit audit", async () => {
      await establish();
      await transfer();
      expect(await transfer(carol)).toBe("conflict");
      expect(await audits()).toHaveLength(2);
    });
    it.each(["follower", "inactive", "left"])(
      "transfer target cannot be %s",
      async (state) => {
        await establish();
        await status(bob, "member", state);
        expect(await transfer()).toBe("denied");
        expect(await audits()).toHaveLength(1);
      },
    );
    it.each(["disabled", "unverified", "absent"])(
      "transfer target factor requirement: %s",
      async (kind) => {
        await establish();
        if (kind === "disabled")
          await f.fixturePool.query(
            'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
            [bob.userId],
          );
        if (kind === "unverified")
          await f.fixturePool.query(
            "UPDATE two_factor SET verified=false WHERE user_id=$1",
            [bob.userId],
          );
        if (kind === "absent")
          await f.fixturePool.query("DELETE FROM two_factor WHERE user_id=$1", [
            bob.userId,
          ]);
        expect(await transfer()).toBe("denied");
        expect(await audits()).toHaveLength(1);
      },
    );
    it.each([
      "missing",
      "no-elevation",
      "no-step",
      "idle",
      "absolute",
      "stale-step",
    ])("transfer denies invalid assurance: %s", async (kind) => {
      await establish();
      if (kind === "missing")
        await f.fixturePool.query(
          "DELETE FROM session_assurance WHERE session_id=$1",
          [alice.sessionId],
        );
      if (kind === "no-elevation")
        await f.fixturePool.query(
          "UPDATE session_assurance SET elevated_at=null WHERE session_id=$1",
          [alice.sessionId],
        );
      if (kind === "no-step")
        await f.fixturePool.query(
          "UPDATE session_assurance SET step_up_at=null WHERE session_id=$1",
          [alice.sessionId],
        );
      if (kind === "idle") {
        now += 15 * 60000;
        await f.fixturePool.query(
          "UPDATE session_assurance SET step_up_at=$2 WHERE session_id=$1",
          [alice.sessionId, new Date(now).toISOString()],
        );
      }
      if (kind === "absolute") {
        now += 8 * 3600000;
        await f.fixturePool.query(
          "UPDATE session_assurance SET step_up_at=$2,last_elevated_activity_at=$2 WHERE session_id=$1",
          [alice.sessionId, new Date(now).toISOString()],
        );
      }
      if (kind === "stale-step") now += 5 * 60000;
      expect(await transfer()).toBe("denied");
      expect(await audits()).toHaveLength(1);
    });
    it("just before five-minute boundary valid proof transfers", async () => {
      await establish();
      now += 5 * 60000 - 1;
      expect(await transfer()).toBe("changed");
    });
    it("same owner's second session cannot reuse first session assurance", async () => {
      await establish();
      const id = randomUUID();
      await f.fixturePool.query(
        "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)",
        [
          id,
          alice.userId,
          randomBytes(32).toString("hex"),
          new Date(now - 1000).toISOString(),
          new Date(now + 86400000).toISOString(),
        ],
      );
      expect(
        await service.transferPrimaryOwner(
          A,
          { userId: alice.userId, sessionId: id },
          bob.membershipId,
        ),
      ).toBe("denied");
      expect(await audits()).toHaveLength(1);
    });
    it("absolute-expired normal session cannot transfer despite fresh assurance", async () => {
      await establish();
      await f.fixturePool.query(
        "UPDATE session SET created_at=$2 WHERE id=$1",
        [alice.sessionId, new Date(now - 30 * 86400000).toISOString()],
      );
      expect(await transfer()).toBe("denied");
      expect(await service.isPrimaryOwner(A, subject())).toBe(false);
    });
    it.each(["inactive", "follower", "left"])(
      "owner state %s denies immediately and member restoration reactivates relationship",
      async (state) => {
        await establish();
        await status(alice, "member", state);
        expect(await service.isPrimaryOwner(A, subject())).toBe(false);
        expect(await transfer()).toBe("denied");
        expect((await owner())!.membershipId).toBe(alice.membershipId);
        await status(alice, state, "member");
        expect(await service.isPrimaryOwner(A, subject())).toBe(true);
      },
    );
    it("disabled factor invalidates owner predicate and transfer despite a retained row", async () => {
      await establish();
      await f.fixturePool.query(
        'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
        [alice.userId],
      );
      expect(await service.isPrimaryOwner(A, subject())).toBe(false);
      expect(await transfer()).toBe("denied");
      expect(await audits()).toHaveLength(1);
    });
    it("cross-tenant and missing membership are indistinguishable safe targets", async () => {
      await establish();
      expect(await transfer(outside)).toBe("not_found");
      expect(
        await service.transferPrimaryOwner(A, subject(), randomUUID()),
      ).toBe("not_found");
      expect(await service.isPrimaryOwner(B, subject())).toBe(false);
      expect(await audits(B)).toHaveLength(0);
    });
    it("composite FK rejects privileged fixture SQL with foreign membership", async () => {
      let code;
      try {
        await f.fixturePool.query(
          "INSERT INTO church_primary_owner(church_id,membership_id) VALUES($1,$2)",
          [A.churchId, outside.membershipId],
        );
      } catch (e) {
        code = (e as { code: string }).code;
      }
      expect(code).toBe("23503");
      expect(await owner()).toBeNull();
    });
    it("primary key independently rejects duplicate owner", async () => {
      await establish();
      let code;
      try {
        await f.fixturePool.query(
          "INSERT INTO church_primary_owner(church_id,membership_id) VALUES($1,$2)",
          [A.churchId, bob.membershipId],
        );
      } catch (e) {
        code = (e as { code: string }).code;
      }
      expect(code).toBe("23505");
      expect(await audits()).toHaveLength(1);
    });
    it("RLS hides both tables without context and rejects unscoped writes", async () => {
      await establish();
      expect(
        (await f.runtimePool.query("SELECT * FROM church_primary_owner")).rows,
      ).toEqual([]);
      expect(
        (await f.runtimePool.query("SELECT * FROM church_ownership_audit"))
          .rows,
      ).toEqual([]);
      await expect(
        f.runtimePool.query(
          "INSERT INTO church_primary_owner(church_id,membership_id) VALUES($1,$2)",
          [B.churchId, outside.membershipId],
        ),
      ).rejects.toThrow();
      expect(
        (
          await f.runtimePool.query(
            "UPDATE church_primary_owner SET membership_id=$1 RETURNING church_id",
            [bob.membershipId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await f.runtimePool.query(
            "DELETE FROM church_primary_owner RETURNING church_id",
          )
        ).rows,
      ).toEqual([]);
    });
    it("repository A under RLS B sees neither ownership nor audits and cannot mutate", async () => {
      await establish();
      await establish(outside, B);
      await f.withTenant(B, async (tx) => {
        expect(await repo.current(A, tx)).toBeNull();
        expect(await repo.recentAudit(A, tx)).toEqual([]);
        expect(
          await repo.change(
            A,
            tx,
            subject(),
            bob.membershipId,
            alice.membershipId,
          ),
        ).toBe(false);
      });
      expect((await owner())!.membershipId).toBe(alice.membershipId);
      expect(await audits()).toHaveLength(1);
      await expect(
        f.withTenant(A, (tx) =>
          tx.execute(
            sql`insert into church_ownership_audit(id,church_id,event_type,new_owner_membership_id,actor_user_id,actor_session_id) values(${randomUUID()},${B.churchId},'initial_owner_established',${outside.membershipId},${outside.userId},${outside.sessionId})`,
          ),
        ),
      ).rejects.toThrow();
    });
    it("known B ownership cannot be read/updated/deleted under runtime A", async () => {
      await establish(outside, B);
      await f.withTenant(A, async (tx) => {
        expect(
          (
            await tx.execute(
              sql`select * from church_primary_owner where church_id=${B.churchId}`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await tx.execute(
              sql`update church_primary_owner set membership_id=${bob.membershipId} where church_id=${B.churchId} returning church_id`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await tx.execute(
              sql`delete from church_primary_owner where church_id=${B.churchId} returning church_id`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await tx.execute(
              sql`select * from church_ownership_audit where church_id=${B.churchId}`,
            )
          ).rows,
        ).toEqual([]);
      });
    });
    it("audit is append-only even when fixture runtime has CRUD grants", async () => {
      await establish();
      const before = await audits();
      await f.withTenant(A, async (tx) => {
        expect(
          (
            await tx.execute(
              sql`update church_ownership_audit set actor_user_id='changed' where church_id=${A.churchId} returning id`,
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await tx.execute(
              sql`delete from church_ownership_audit where church_id=${A.churchId} returning id`,
            )
          ).rows,
        ).toEqual([]);
      });
      expect(await audits()).toEqual(before);
    });
    it.each(["initial", "transfer"])(
      "audit insert failure rolls back %s ownership without leaked diagnostics",
      async (phase) => {
        if (phase === "transfer") await establish();
        const before = await owner(),
          history = await audits();
        await f.fixturePool.query(
          "CREATE FUNCTION ownership_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-ownership-driver-detail'; END $$; CREATE TRIGGER fail_ownership_audit BEFORE INSERT ON church_ownership_audit FOR EACH ROW EXECUTE FUNCTION ownership_audit_failure()",
        );
        try {
          await expect(
            phase === "initial" ? establish() : transfer(),
          ).rejects.toThrow("Ownership operation failed");
          expect(await owner()).toEqual(before);
          expect(await audits()).toEqual(history);
        } finally {
          await f.fixturePool.query(
            "DROP TRIGGER fail_ownership_audit ON church_ownership_audit; DROP FUNCTION ownership_audit_failure()",
          );
        }
      },
    );
    it.each(["membership", "user"])(
      "%s deletion cascades ownership but preserves audit snapshots",
      async (kind) => {
        await establish();
        await transfer();
        const before = await audits();
        if (kind === "membership")
          await f.withTenant(A, (tx) =>
            tx.execute(
              sql`delete from church_membership where church_id=${A.churchId} and id=${bob.membershipId}`,
            ),
          );
        else
          await f.fixturePool.query('DELETE FROM "user" WHERE id=$1', [
            bob.userId,
          ]);
        expect(await owner()).toBeNull();
        expect(await audits()).toEqual(before);
        await f.fixturePool.query('DELETE FROM "user" WHERE id=$1', [
          alice.userId,
        ]);
        expect(await audits()).toEqual(before);
      },
    );
    it("full church deletion cascades its ownership and audit only", async () => {
      await establish();
      await establish(outside, B);
      await f.withTenant(A, (tx) =>
        tx.execute(sql`delete from church where id=${A.churchId}`),
      );
      expect(await owner()).toBeNull();
      expect(await audits()).toHaveLength(0);
      expect(await audits(B)).toHaveLength(1);
    });
    it("ownership does not mutate roles, grants, sessions, assurance or secrets", async () => {
      const snapshot = async () =>
        JSON.stringify(
          (
            await f.fixturePool.query(
              "SELECT id,user_id,created_at,expires_at FROM session ORDER BY id",
            )
          ).rows,
        );
      const before = await snapshot();
      await establish();
      await transfer();
      expect(await snapshot()).toBe(before);
      for (const table of [
        "church_role",
        "church_role_permission",
        "church_membership_role",
      ])
        expect(
          (await f.fixturePool.query("SELECT count(*)::int n FROM " + table))
            .rows[0].n,
        ).toBe(0);
      const fields = Object.keys((await audits())[0]!);
      expect(fields.sort()).toEqual(
        [
          "id",
          "churchId",
          "eventType",
          "previousOwnerMembershipId",
          "newOwnerMembershipId",
          "actorUserId",
          "actorSessionId",
          "createdAt",
        ].sort(),
      );
    });
    it("untrusted context and actor claims cannot select ownership", async () => {
      await expect(
        service.establishInitialOwner(
          { churchId: A.churchId } as TenantContext,
          subject(),
          alice.membershipId,
        ),
      ).rejects.toThrow("Trusted tenant context required");
      const injected = { ...subject(), isOwner: true };
      await expect(
        service.establishInitialOwner(A, injected, alice.membershipId),
      ).rejects.toThrow("Server-resolved ownership actor required");
    });

    it("0008 upgrade and repeat migration preserve existing auth, factor, assurance, church and authorization rows", async () => {
      const prior = baseTenantFixtures();
      const before = new Map<string, string>();
      const dataTables = [
        "user",
        "account",
        "session",
        "two_factor",
        "session_assurance",
        "church",
        "church_membership",
        "church_role",
        "church_role_permission",
        "church_membership_role",
      ];
      const snapshot = async (pool: typeof f.fixturePool) => {
        const result = new Map<string, string>();
        for (const table of dataTables)
          result.set(
            table,
            JSON.stringify(
              (await pool.query('SELECT * FROM "' + table + '" ORDER BY 1'))
                .rows,
            ),
          );
        return result;
      };
      const upgraded = await createTenantTestFixture({
        protectedTables: tables,
        upgrade: {
          throughTag: "0008_two_factor_enrollment_binding",
          before: async (pool) => {
            await seedTenantFixtures(pool, prior, { memberships: true });
            await pool.query(
              'UPDATE "user" SET two_factor_enabled=true WHERE id=$1',
              [prior.userA.userId],
            );
            await pool.query(
              "INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES('existing-account',$1,'credential',$1,'fixture-only-hash',now())",
              [prior.userA.userId],
            );
            await pool.query(
              "INSERT INTO session(id,user_id,token,updated_at,expires_at) VALUES('existing-session',$1,$2,now(),now()+interval '1 day')",
              [prior.userA.userId, randomBytes(32).toString("hex")],
            );
            await pool.query(
              "INSERT INTO session_assurance(session_id,elevated_at,last_elevated_activity_at,step_up_at) VALUES('existing-session',now(),now(),now())",
            );
            await pool.query(
              "INSERT INTO two_factor(id,user_id,secret,backup_codes,verified) VALUES('existing-factor',$1,$2,$3,true)",
              [
                prior.userA.userId,
                randomBytes(48).toString("hex"),
                randomBytes(48).toString("hex"),
              ],
            );
            await pool.query(
              "INSERT INTO church_role(id,church_id,name) VALUES('existing-role',$1,'Existing role')",
              [prior.tenantA.churchId],
            );
            await pool.query(
              "INSERT INTO church_role_permission(church_id,role_id,permission) VALUES($1,'existing-role','members.view')",
              [prior.tenantA.churchId],
            );
            await pool.query(
              "INSERT INTO church_membership_role(church_id,membership_id,role_id) VALUES($1,$2,'existing-role')",
              [prior.tenantA.churchId, prior.relationshipA.id],
            );
            for (const [table, value] of await snapshot(pool))
              before.set(table, value);
          },
          after: async (pool) => {
            const after = await snapshot(pool);
            for (const table of dataTables)
              expect(after.get(table) === before.get(table)).toBe(true);
            expect(
              (
                await pool.query(
                  "SELECT count(*)::int n FROM church_primary_owner",
                )
              ).rows[0].n,
            ).toBe(0);
          },
        },
      });
      try {
        await upgraded.assertRestrictedRole();
        await migrateFixture(upgraded.fixturePool);
        const after = await snapshot(upgraded.fixturePool);
        for (const table of dataTables)
          expect(after.get(table) === before.get(table)).toBe(true);
        expect(
          (
            await upgraded.fixturePool.query(
              "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
            )
          ).rows[0].n,
        ).toBe(12);
      } finally {
        await upgraded.dispose();
      }
    }, 30000);
    it.each(["revoked-session", "expired-proof", "target-inactive"])(
      "rechecks %s after database lock wait",
      async (kind) => {
        await establish();
        const blocker = await f.fixturePool.connect();
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM church WHERE id=$1 FOR UPDATE", [
          A.churchId,
        ]);
        const pending = transfer(bob, alice, concurrent);
        try {
          let blocked = false;
          for (let n = 0; n < 100; n++) {
            const rows = await f.fixturePool.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
              [f.roleName],
            );
            if (rows.rows[0].n > 0) {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(blocked).toBe(true);
          if (kind === "revoked-session")
            await f.fixturePool.query("DELETE FROM session WHERE id=$1", [
              alice.sessionId,
            ]);
          if (kind === "expired-proof") now += 5 * 60000;
          if (kind === "target-inactive")
            await status(bob, "member", "inactive");
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
        }
        expect(await pending).toBe("denied");
        expect((await owner())!.membershipId).toBe(alice.membershipId);
        expect(await audits()).toHaveLength(1);
      },
      10000,
    );
  });
}
