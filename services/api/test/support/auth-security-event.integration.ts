import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { authSecurityEvent } from "../../src/database/schema/auth-security-event.js";
import { user } from "../../src/database/schema/auth.js";
import { AuthSecurityEventService } from "../../src/auth/auth-security-event.service.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import { migrateFixture } from "./tenant/migration-fixture.js";

export function authSecurityEventIntegrationTests() {
  describe("global durable authentication security events", () => {
    let f: TenantTestFixture;
    const writer = new AuthSecurityEventService();
    const input = {
      eventType: "two_factor_enabled" as const,
      actorUserId: "historical-user",
      subjectUserId: "historical-user",
      sessionId: "historical-session",
      metadata: {},
    };
    beforeAll(async () => {
      f = await createTenantTestFixture({
        protectedTables: ["church"],
        upgrade: {
          throughTag: "0010_church_admin_audit_foundation",
          before: async (pool) => {
            await pool.query(
              `INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('preserved-user','Preserved','preserved@example.invalid',true,now(),now())`,
            );
            await pool.query(
              `INSERT INTO verification (id,identifier,value,expires_at,created_at,updated_at) VALUES ('preserved-event','preserved-google-preauth','inert-fixture',now()+interval '10 minutes',now(),now())`,
            );
          },
        },
      });
      await f.fixturePool.query(
        `GRANT INSERT ON auth_security_event TO "${f.roleName}"`,
      );
    }, 30000);
    beforeEach(async () => {
      await f.fixturePool.query("TRUNCATE auth_security_event");
    });
    afterAll(async () => {
      await f?.dispose();
    });
    async function rows() {
      return (
        await f.fixturePool.query(
          "SELECT * FROM auth_security_event ORDER BY id",
        )
      ).rows;
    }
    it("upgrades through 0011 and repeated migration preserves identity, verification and event data", async () => {
      await f.runtimeDb.transaction((tx) => writer.record(tx, input));
      const before = JSON.stringify(await rows());
      await migrateFixture(f.fixturePool);
      expect(
        (
          await f.fixturePool.query(
            "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(12);
      expect(
        (
          await f.fixturePool.query(
            `SELECT count(*)::int n FROM "user" WHERE id='preserved-user'`,
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await f.fixturePool.query(
            "SELECT count(*)::int n FROM verification WHERE id='preserved-event'",
          )
        ).rows[0].n,
      ).toBe(1);
      expect(JSON.stringify(await rows()) === before).toBe(true);
    });
    it("writes without tenant context, with generated identity, outcome and timestamp", async () => {
      expect(
        (
          await f.runtimePool.query(
            "select current_setting('app.current_church_id',true) context",
          )
        ).rows[0].context ?? "",
      ).toBe("");
      await f.runtimeDb.transaction((tx) => writer.record(tx, input));
      const [row] = await rows();
      expect(row.event_type).toBe("two_factor_enabled");
      expect(row.outcome).toBe("success");
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.metadata).toEqual({});
      const table = (
        await f.fixturePool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='auth_security_event'::regclass",
        )
      ).rows[0];
      expect(table).toEqual({
        relrowsecurity: false,
        relforcerowsecurity: false,
      });
    });
    it.each([
      "UPDATE auth_security_event SET event_type='password_reset'",
      "DELETE FROM auth_security_event",
      "TRUNCATE auth_security_event",
      "SELECT * FROM auth_security_event",
    ])(
      "runtime cannot rewrite, delete or read audit: %s",
      async (statement) => {
        await expect(f.runtimePool.query(statement)).rejects.toMatchObject({
          code: "42501",
        });
      },
    );
    it("history survives deletion of its referenced user and has no cascading foreign keys", async () => {
      await f.fixturePool.query(
        `INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('historical-user','Historical','historical@example.invalid',true,now(),now())`,
      );
      await f.runtimeDb.transaction((tx) => writer.record(tx, input));
      await f.fixturePool.query(
        `DELETE FROM "user" WHERE id='historical-user'`,
      );
      expect((await rows())[0].subject_user_id).toBe("historical-user");
      expect(
        (
          await f.fixturePool.query(
            "SELECT count(*)::int n FROM pg_constraint WHERE conrelid='auth_security_event'::regclass AND contype='f'",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it.each([
      { eventType: "unknown", metadata: {}, actor: "a", outcome: "success" },
      {
        eventType: "two_factor_enabled",
        metadata: { password: "private-test-value" },
        actor: "a",
        outcome: "success",
      },
      {
        eventType: "two_factor_enabled",
        metadata: {},
        actor: null,
        outcome: "success",
      },
      {
        eventType: "two_factor_enabled",
        metadata: {},
        actor: "a",
        outcome: "failure",
      },
    ])("database constraints reject unsafe event %#", async (row) => {
      await expect(
        f.runtimePool.query(
          "INSERT INTO auth_security_event(id,event_type,actor_user_id,subject_user_id,outcome,metadata) VALUES('invalid',$1,$2,$2,$3,$4)",
          [row.eventType, row.actor, row.outcome, JSON.stringify(row.metadata)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await rows()).toHaveLength(0);
    });
    it("mandatory event insertion failure rolls back its enclosing mutation", async () => {
      await expect(
        f.fixtureDb.transaction(async (tx) => {
          await tx
            .update(user)
            .set({ name: "Must roll back" })
            .where(eq(user.id, "preserved-user"));
          await tx.insert(authSecurityEvent).values({
            eventType: "two_factor_enabled",
            actorUserId: null,
            subjectUserId: null,
            sessionId: null,
            outcome: "success",
            metadata: {},
          });
        }),
      ).rejects.toThrow();
      expect(
        (
          await f.fixturePool.query(
            `SELECT name FROM "user" WHERE id='preserved-user'`,
          )
        ).rows[0].name,
      ).toBe("Preserved");
      expect(await rows()).toHaveLength(0);
    });
    it("classified failure persistence survives the concluded authentication transaction rollback and grants nothing", async () => {
      await expect(
        f.fixtureDb.transaction(async (tx) => {
          await tx
            .update(user)
            .set({ name: "Not committed" })
            .where(eq(user.id, "preserved-user"));
          throw new Error("conclusive fixture authentication failure");
        }),
      ).rejects.toThrow();
      await writer.recordFailure(f.runtimeDb, {
        eventType: "authentication_failure",
        actorUserId: null,
        subjectUserId: "preserved-user",
        sessionId: null,
        metadata: { method: "recovery", category: "repeated" },
      });
      expect((await rows())[0].outcome).toBe("failure");
      expect(
        (await f.fixturePool.query("SELECT count(*)::int n FROM session"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await f.fixturePool.query(
            "SELECT count(*)::int n FROM session_assurance",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("unknown input fails closed without producing a record", async () => {
      await expect(
        f.runtimeDb.transaction((tx) =>
          writer.record(tx, { ...input, eventType: "arbitrary" } as never),
        ),
      ).rejects.toThrow("Invalid authentication security event");
      expect(await rows()).toHaveLength(0);
    });
  });
}
