import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ChurchRepository } from "../../src/church/church.repository.js";
import { ChurchVerificationService } from "../../src/church/church-verification.service.js";
import {
  evaluateChurchVerificationTransition,
  type ChurchVerificationState,
} from "../../src/church/church-verification-policy.js";
import { church } from "../../src/database/schema/church.js";
import type { DatabaseTransaction } from "../../src/database/database.types.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import { AuthorizationService } from "../../src/authorization/authorization.service.js";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import {
  assertNoContext,
  assertFailureIsolation,
} from "./tenant/tenant-isolation.js";
import { migrateFixture } from "./tenant/migration-fixture.js";

export function churchVerificationIntegrationTests() {
  describe("church verification request and isolated review primitive", () => {
    const base = baseTenantFixtures(),
      A = base.tenantA.context,
      B = base.tenantB.context;
    const repository = new ChurchRepository();
    let fixture: TenantTestFixture, service: ChurchVerificationService;
    const read = (context: TenantContext) =>
      fixture.withTenant(context, (tx) =>
        repository.getCurrentChurch(context, tx),
      );
    // Fixture setup only. This is not a production review/authorization path.
    const seedState = async (state: ChurchVerificationState) => {
      await fixture.fixturePool.query(
        "update church set verification_state=$1,updated_at='2020-01-01T00:00:00Z' where id=$2",
        [state, A.churchId],
      );
    };
    // Test-only compare-and-set probe. Platform review persistence is NOT shipped.
    // Even this primitive uses scoped restricted transactions, never a runtime bypass.
    async function reviewProbe(
      context: TenantContext,
      tx: DatabaseTransaction,
      expected: ChurchVerificationState,
      next: ChurchVerificationState,
    ) {
      const decision = evaluateChurchVerificationTransition(expected, next);
      if (decision.outcome !== "transition" || decision.authority !== "review")
        return "invalid_transition";
      const rows = await tx
        .update(church)
        .set({ verificationState: decision.to, updatedAt: new Date() })
        .where(
          and(
            eq(church.id, context.churchId),
            eq(church.verificationState, decision.from),
          ),
        )
        .returning({ id: church.id });
      return rows.length === 1 ? "changed" : "stale";
    }
    // Force two live transactions on different connections to reach the operation.
    async function race<T>(
      first: (tx: DatabaseTransaction) => Promise<T>,
      second: (tx: DatabaseTransaction) => Promise<T>,
    ) {
      let arrived = 0,
        release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Concurrent probe timed out")),
          5000,
        );
      });
      const go = (work: (tx: DatabaseTransaction) => Promise<T>) =>
        fixture.concurrentTenantDatabase.transaction(A, async (tx) => {
          const pid = (await tx.execute(sql`select pg_backend_pid() pid`))
            .rows[0]!.pid;
          if (++arrived === 2) release();
          await Promise.race([gate, deadline]);
          return { pid, result: await work(tx) };
        });
      try {
        const results = await Promise.allSettled([go(first), go(second)]);
        const values = results.map((result) => {
          if (result.status !== "fulfilled")
            throw new Error("Concurrent probe failed");
          return result.value;
        });
        expect(values[0]!.pid).not.toBe(values[1]!.pid);
        return values.map((v) => v.result);
      } finally {
        clearTimeout(timer);
      }
    }
    beforeAll(async () => {
      fixture = await createTenantTestFixture({
        protectedTables: [
          "church",
          "church_membership",
          "church_role",
          "church_role_permission",
          "church_membership_role",
        ],
      });
      service = new ChurchVerificationService(
        fixture.tenantDatabase,
        repository,
      );
      // Read-only global identity/session observations in this disposable fixture;
      // no write permissions to global auth tables are granted to tenant runtime.
      await fixture.fixturePool.query(
        `GRANT SELECT (id,user_id,created_at) ON session TO "${fixture.roleName}"`,
      );
      await fixture.fixturePool.query(
        `GRANT SELECT (id,two_factor_enabled) ON "user" TO "${fixture.roleName}"`,
      );
      await fixture.assertRestrictedRole();
    }, 30000);
    afterAll(async () => {
      await fixture?.dispose();
    });
    beforeEach(async () => {
      await seedTenantFixtures(fixture.fixturePool, base, {
        memberships: true,
      });
    });

    it("clean migration chain ends at 0006 and a new church defaults to unverified", async () => {
      expect((await read(A))!.verificationState).toBe("unverified");
      // Migration journal is administrative metadata, not protected church data.
      expect(
        (
          await fixture.fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(8);
    });
    it.each(["unverified", "rejected", "revoked"] as const)(
      "requests %s -> pending only for A, preserving other church fields",
      async (state) => {
        await seedState(state);
        const before = await read(A),
          foreign = await read(B);
        expect(await service.requestVerification(A)).toEqual({
          outcome: "changed",
          state: "pending",
        });
        const after = await read(A);
        expect(after).toEqual({
          ...before,
          verificationState: "pending",
          updatedAt: after!.updatedAt,
        });
        expect(after!.updatedAt.getTime()).toBeGreaterThan(
          before!.updatedAt.getTime(),
        );
        expect(await read(B)).toEqual(foreign);
      },
    );
    it("pending request is unchanged and preserves updatedAt", async () => {
      await seedState("pending");
      const before = await read(A);
      expect(await service.requestVerification(A)).toEqual({
        outcome: "unchanged",
        state: "pending",
      });
      expect(await read(A)).toEqual(before);
    });
    it("verified cannot request pending or any direct alternative state", async () => {
      await seedState("verified");
      const before = await read(A);
      expect(await service.requestVerification(A)).toEqual({
        outcome: "invalid_transition",
        state: "verified",
      });
      expect(await read(A)).toEqual(before);
    });
    it("two overlapping requests have one actual mutation and one unchanged result", async () => {
      const results = await race(
        (tx) => repository.requestVerification(A, tx),
        (tx) => repository.requestVerification(A, tx),
      );
      expect(results.map((r) => r.outcome).sort()).toEqual([
        "changed",
        "unchanged",
      ]);
      expect((await read(A))!.verificationState).toBe("pending");
      await assertNoContext(fixture, sql`select * from church`);
    });
    it.each([
      ["pending", "verified"],
      ["pending", "rejected"],
      ["verified", "revoked"],
    ] as const)(
      "review policy %s -> %s works through the test-only scoped primitive",
      async (from, to) => {
        await seedState(from);
        expect(
          await fixture.withTenant(A, (tx) => reviewProbe(A, tx, from, to)),
        ).toBe("changed");
        expect((await read(A))!.verificationState).toBe(to);
        expect((await read(B))!.verificationState).toBe("unverified");
      },
    );
    it("conflicting concurrent review probes have exactly one winner, not last-writer-wins", async () => {
      await seedState("pending");
      const results = await race(
        (tx) => reviewProbe(A, tx, "pending", "verified"),
        (tx) => reviewProbe(A, tx, "pending", "rejected"),
      );
      expect([...results].sort()).toEqual(["changed", "stale"]);
      expect((await read(A))!.verificationState).toBe(
        results[0] === "changed" ? "verified" : "rejected",
      );
    });
    it.each([
      ["unverified", "verified"],
      ["revoked", "verified"],
      ["verified", "rejected"],
      ["pending", "revoked"],
    ] as const)(
      "forbidden review %s -> %s makes no write",
      async (from, to) => {
        await seedState(from);
        const before = await read(A);
        expect(
          await fixture.withTenant(A, (tx) => reviewProbe(A, tx, from, to)),
        ).toBe("invalid_transition");
        expect(await read(A)).toEqual(before);
      },
    );
    it("rejected request can be resubmitted after review rejection", async () => {
      await service.requestVerification(A);
      await fixture.withTenant(A, (tx) =>
        reviewProbe(A, tx, "pending", "rejected"),
      );
      expect(await service.requestVerification(A)).toEqual({
        outcome: "changed",
        state: "pending",
      });
    });
    it("revoked verification requires a new pending review", async () => {
      await seedState("verified");
      await fixture.withTenant(A, (tx) =>
        reviewProbe(A, tx, "verified", "revoked"),
      );
      expect(
        await fixture.withTenant(A, (tx) =>
          reviewProbe(A, tx, "revoked", "verified"),
        ),
      ).toBe("invalid_transition");
      expect(await service.requestVerification(A)).toEqual({
        outcome: "changed",
        state: "pending",
      });
    });
    it("inactive church status remains independent even when verified", async () => {
      await fixture.fixturePool.query(
        "update church set status='inactive' where id=$1",
        [A.churchId],
      );
      await service.requestVerification(A);
      await fixture.withTenant(A, (tx) =>
        reviewProbe(A, tx, "pending", "verified"),
      );
      expect(await read(A)).toMatchObject({
        status: "inactive",
        verificationState: "verified",
      });
    });
    it("ordinary details update rejects verificationState without modifying either church", async () => {
      const before = await read(A),
        foreign = await read(B);
      await expect(
        fixture.withTenant(A, (tx) =>
          repository.updateCurrentChurch(A, tx, {
            name: "Attempt",
            slug: "attempt",
            verificationState: "verified",
          }),
        ),
      ).rejects.toThrow("Invalid church details");
      expect(await read(A)).toEqual(before);
      expect(await read(B)).toEqual(foreign);
    });
    it("known foreign church ID cannot redirect an ordinary update or request", async () => {
      const foreign = await read(B);
      await expect(
        fixture.withTenant(A, (tx) =>
          repository.updateCurrentChurch(A, tx, {
            id: B.churchId,
            name: "Attempt",
            slug: "attempt",
          }),
        ),
      ).rejects.toThrow();
      // No production parameter exists for a caller-selected church or target state.
      expect(await service.requestVerification(A)).toEqual({
        outcome: "changed",
        state: "pending",
      });
      expect(await read(B)).toEqual(foreign);
    });
    it("missing/forged TenantContext fails before any mutation", async () => {
      const before = await read(A);
      // @ts-expect-error deliberately missing scope
      await expect(service.requestVerification()).rejects.toThrow(
        "Trusted tenant context required",
      );
      await expect(
        // @ts-expect-error deliberately forged scope
        service.requestVerification({ churchId: A.churchId }),
      ).rejects.toThrow("Trusted tenant context required");
      expect(await read(A)).toEqual(before);
    });
    it("missing RLS context hides the row and makes no write", async () => {
      expect(
        await fixture.runtimeDb.transaction((tx) =>
          repository.requestVerification(A, tx),
        ),
      ).toEqual({ outcome: "not_found" });
      expect((await read(A))!.verificationState).toBe("unverified");
      await assertNoContext(fixture, sql`select * from church`);
    });
    it("repository A under RLS B changes neither tenant", async () => {
      const before = await read(A),
        foreign = await read(B);
      expect(
        await fixture.withTenant(B, (tx) =>
          repository.requestVerification(A, tx),
        ),
      ).toEqual({ outcome: "not_found" });
      expect(await read(A)).toEqual(before);
      expect(await read(B)).toEqual(foreign);
    });
    it("unknown church returns not_found with no default tenant", async () => {
      expect(
        await service.requestVerification(
          TenantContext.fromAuthorizedScope(randomUUID()),
        ),
      ).toEqual({ outcome: "not_found" });
      expect((await read(A))!.verificationState).toBe("unverified");
    });
    it("rollback removes a request transition and clears pooled tenant state", async () => {
      const before = await read(A);
      await assertFailureIsolation(
        fixture,
        A,
        sql`select * from church`,
        async (tx) => {
          await repository.requestVerification(A, tx);
          throw new Error("Deliberate rollback");
        },
        async () => {
          expect(await read(A)).toEqual(before);
        },
        "Deliberate rollback",
      );
    });
    it("verified trust metadata changes no grants, relationships, sessions or MFA state", async () => {
      const authzRepo = new AuthorizationRepository(),
        authz = new AuthorizationService(fixture.tenantDatabase, authzRepo);
      await fixture.withTenant(A, async (tx) => {
        const role = await authzRepo.createRole(A, tx, { name: "Readers" });
        await authzRepo.addRolePermission(A, tx, role.id, "members.view");
        await authzRepo.assignRole(A, tx, base.relationshipA.id, role.id);
      });
      const snapshot = (context: TenantContext) =>
        fixture.withTenant(context, async (tx) => ({
          memberships: (
            await tx.execute(sql`select * from church_membership order by id`)
          ).rows,
          roles: (await tx.execute(sql`select * from church_role order by id`))
            .rows,
          permissions: (
            await tx.execute(
              sql`select * from church_role_permission order by role_id,permission`,
            )
          ).rows,
          assignments: (
            await tx.execute(
              sql`select * from church_membership_role order by membership_id,role_id`,
            )
          ).rows,
          sessions: (
            await tx.execute(
              sql`select id,user_id,created_at from session order by id`,
            )
          ).rows,
          users: (
            await tx.execute(
              sql`select id,two_factor_enabled from "user" order by id`,
            )
          ).rows,
        }));
      const before = await snapshot(A),
        foreign = await snapshot(B);
      await service.requestVerification(A);
      await fixture.withTenant(A, (tx) =>
        reviewProbe(A, tx, "pending", "verified"),
      );
      expect(await snapshot(A)).toEqual(before);
      expect(await snapshot(B)).toEqual(foreign);
      expect(
        await authz.hasPermission(A, base.relationshipA.id, "members.view"),
      ).toBe(true);
      expect(
        await authz.hasPermission(A, base.relationshipA.id, "events.create"),
      ).toBe(false);
      expect(
        await authz.hasPermission(B, base.relationshipA.id, "members.view"),
      ).toBe(false);
      expect(
        await authz.hasPermission(
          A,
          base.relationshipA.id,
          "verification.manage",
        ),
      ).toBe(false);
      await assertNoContext(fixture, sql`select * from church`);
    });
    it("repeated migrations preserve church verification and seven journal entries", async () => {
      await service.requestVerification(A);
      const before = await read(A);
      await migrateFixture(fixture.fixturePool);
      expect(await read(A)).toEqual(before);
      expect(
        (
          await fixture.fixturePool.query(
            "select count(*)::int n from drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(8);
    });
  });
}
