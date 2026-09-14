import { randomUUID, randomBytes } from "node:crypto";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import {
  ChurchOnboardingService,
  ChurchSlugConflictError,
  OnboardingDeniedError,
} from "../../src/onboarding/church-onboarding.service.js";
import { ChurchRepository } from "../../src/church/church.repository.js";
import { MembershipRepository } from "../../src/membership/membership.repository.js";
import { OwnershipRepository } from "../../src/ownership/ownership.repository.js";
import { OwnershipService } from "../../src/ownership/ownership.service.js";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import { StandardRoleService } from "../../src/authorization/standard-role.service.js";
import {
  STANDARD_ROLES,
  standardRoleId,
} from "../../src/authorization/standard-roles.js";
import { SessionAssuranceService } from "../../src/auth/session-assurance.service.js";
import { AssurancePolicy } from "../../src/auth/assurance-policy.js";
import { TenantContext } from "../../src/database/tenant-context.js";
import { TenantDatabase } from "../../src/database/tenant-database.js";
import type { DatabaseService } from "../../src/database/database.service.js";
import type { DatabaseTransaction } from "../../src/database/database.types.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import { migrateFixture } from "./tenant/migration-fixture.js";

export function onboardingIntegrationTests() {
  describe("atomic internal church onboarding with restricted runtime", () => {
    const tables = [
      "church",
      "church_membership",
      "church_role",
      "church_role_permission",
      "church_membership_role",
      "church_primary_owner",
      "church_ownership_audit",
    ];
    const actor = { userId: randomUUID(), sessionId: randomUUID() };
    const stranger = { userId: randomUUID(), sessionId: randomUUID() };
    const churches = new ChurchRepository(),
      members = new MembershipRepository(),
      ownerRepo = new OwnershipRepository(),
      rolesRepo = new AuthorizationRepository();
    let f: TenantTestFixture, now: number;
    let owner: OwnershipService,
      roles: StandardRoleService,
      service: ChurchOnboardingService,
      concurrent: ChurchOnboardingService;
    function build(database: DatabaseService, tenants: TenantDatabase) {
      const ownership = new OwnershipService(
        tenants,
        ownerRepo,
        new SessionAssuranceService(database, new AssurancePolicy(() => now)),
      );
      const standardRoles = new StandardRoleService(tenants, rolesRepo);
      return {
        ownership,
        standardRoles,
        onboarding: new ChurchOnboardingService(
          database,
          tenants,
          churches,
          members,
          ownership,
          standardRoles,
        ),
      };
    }
    beforeAll(async () => {
      f = await createTenantTestFixture({ protectedTables: tables });
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
      const main = build(f.runtimeDb, f.tenantDatabase);
      owner = main.ownership;
      roles = main.standardRoles;
      service = main.onboarding;
      concurrent = build(f.concurrentDb, f.concurrentTenantDatabase).onboarding;
    }, 30000);
    afterAll(async () => {
      await f?.dispose();
    });
    afterEach(() => vi.restoreAllMocks());
    beforeEach(async () => {
      now = Date.now();
      await f.fixturePool.query("TRUNCATE church CASCADE");
      await f.fixturePool.query(
        'DELETE FROM "user" WHERE id = ANY($1::text[])',
        [[actor.userId, stranger.userId]],
      );
      for (const subject of [actor, stranger]) {
        await f.fixturePool.query(
          'INSERT INTO "user"(id,name,email,email_verified,two_factor_enabled) VALUES($1,$2,$3,true,true)',
          [
            subject.userId,
            "Onboarding fixture",
            subject.userId + "@example.invalid",
          ],
        );
        await f.fixturePool.query(
          "INSERT INTO two_factor(id,user_id,secret,backup_codes,verified) VALUES($1,$2,$3,$4,true)",
          [
            randomUUID(),
            subject.userId,
            randomBytes(48).toString("hex"),
            randomBytes(48).toString("hex"),
          ],
        );
        await f.fixturePool.query(
          "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)",
          [
            subject.sessionId,
            subject.userId,
            randomBytes(32).toString("hex"),
            new Date(now - 60000).toISOString(),
            new Date(now + 86400000).toISOString(),
          ],
        );
      }
      // Structural factor/session fixtures, no fabricated proof issuer. In particular
      // NO assurance row; native auth remains exercised by the unchanged auth suites.
    });
    const create = (slug = "new-church", subject = actor, using = service) =>
      using.createChurch(subject, { name: "New Church", slug });
    async function counts() {
      return Promise.all(
        tables.map(
          async (table) =>
            (
              await f.fixturePool.query(
                'SELECT count(*)::int n FROM "' + table + '"',
              )
            ).rows[0].n as number,
        ),
      );
    }
    const none = async () =>
      expect(await counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);
    async function complete(id: string, subject = actor) {
      const context = TenantContext.fromAuthorizedScope(id);
      await f.withTenant(context, async (tx) => {
        const c = await churches.getCurrentChurch(context, tx);
        expect(c).toMatchObject({
          id,
          status: "active",
          verificationState: "unverified",
        });
        const m = await members.getRelationshipForUser(
          context,
          tx,
          subject.userId,
        );
        expect(m).toMatchObject({
          churchId: id,
          userId: subject.userId,
          status: "member",
        });
        expect(await ownerRepo.current(context, tx)).toMatchObject({
          churchId: id,
          membershipId: m!.id,
        });
        const events = await ownerRepo.recentAudit(context, tx);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          eventType: "initial_owner_established",
          previousOwnerMembershipId: null,
          newOwnerMembershipId: m!.id,
          actorUserId: subject.userId,
          actorSessionId: subject.sessionId,
        });
        const stored = await rolesRepo.listRoles(context, tx);
        expect(stored).toHaveLength(4);
        for (const definition of STANDARD_ROLES) {
          expect(
            stored.find(
              (r) => r.id === standardRoleId(context, definition.key),
            ),
          ).toMatchObject({ name: definition.name, isSystem: true });
          expect(definition).toMatchObject({
            privileged: false,
            permissions: [],
          });
        }
        expect(
          (
            await tx.execute(
              sql`select count(*)::int n from church_role_permission where church_id=${id}`,
            )
          ).rows[0]!.n,
        ).toBe(0);
        expect(
          (
            await tx.execute(
              sql`select count(*)::int n from church_membership_role where church_id=${id}`,
            )
          ).rows[0]!.n,
        ).toBe(0);
      });
      expect(await owner.isPrimaryOwner(context, subject)).toBe(true);
    }
    it("eligible creator gets exact complete artifacts without elevation or step-up", async () => {
      const result = await create();
      expect(result).toMatchObject({
        church: {
          name: "New Church",
          slug: "new-church",
          status: "active",
          verificationState: "unverified",
        },
        membership: { status: "member" },
        ownership: { isPrimaryOwner: true },
      });
      expect(result.church.id).toMatch(/^[0-9a-f-]{36}$/);
      await complete(result.church.id);
      expect(await counts()).toEqual([1, 1, 4, 0, 0, 1, 1]);
    });
    it("uses the same transaction object/backend/XID across all five provisioning stages", async () => {
      const transactions: DatabaseTransaction[] = [];
      const backends: unknown[] = [];
      const record = async (tx: DatabaseTransaction) => {
        transactions.push(tx);
        backends.push(
          (
            await tx.execute(
              sql`select pg_backend_pid() pid, pg_current_xact_id()::text xid`,
            )
          ).rows[0],
        );
      };
      const c = churches.createChurch.bind(churches),
        m = members.createRelationship.bind(members),
        o = ownerRepo.change.bind(ownerRepo),
        r = rolesRepo.ensureStandardRoles.bind(rolesRepo);
      vi.spyOn(churches, "createChurch").mockImplementation(
        async (ctx, tx, input) => {
          await record(tx);
          return c(ctx, tx, input);
        },
      );
      vi.spyOn(members, "createRelationship").mockImplementation(
        async (ctx, tx, input) => {
          await record(tx);
          return m(ctx, tx, input);
        },
      );
      vi.spyOn(ownerRepo, "change").mockImplementation(
        async (ctx, tx, subject, target, previous) => {
          await record(tx);
          return o(ctx, tx, subject, target, previous);
        },
      );
      vi.spyOn(rolesRepo, "ensureStandardRoles").mockImplementation(
        async (ctx, tx) => {
          await record(tx);
          return r(ctx, tx);
        },
      );
      await create();
      expect(transactions).toHaveLength(4);
      expect(new Set(transactions).size).toBe(1);
      expect(
        backends.every(
          (v) => JSON.stringify(v) === JSON.stringify(backends[0]),
        ),
      ).toBe(true);
    });
    it.each(["absent", "disabled", "pending", "flag-only"])(
      "%s factor cannot begin onboarding",
      async (state) => {
        if (state === "absent" || state === "flag-only")
          await f.fixturePool.query("DELETE FROM two_factor WHERE user_id=$1", [
            actor.userId,
          ]);
        if (state === "absent" || state === "disabled")
          await f.fixturePool.query(
            'UPDATE "user" SET two_factor_enabled=false WHERE id=$1',
            [actor.userId],
          );
        if (state === "pending")
          await f.fixturePool.query(
            "UPDATE two_factor SET verified=false WHERE user_id=$1",
            [actor.userId],
          );
        await expect(create()).rejects.toThrow(OnboardingDeniedError);
        await none();
      },
    );
    it.each(["missing", "revoked", "foreign", "expired", "absolute-expired"])(
      "%s session fails with zero artifacts",
      async (kind) => {
        let subject = actor;
        if (kind === "missing") subject = { ...actor, sessionId: randomUUID() };
        if (kind === "foreign")
          subject = { ...actor, sessionId: stranger.sessionId };
        if (kind === "revoked")
          await f.fixturePool.query("DELETE FROM session WHERE id=$1", [
            actor.sessionId,
          ]);
        if (kind === "expired")
          await f.fixturePool.query(
            "UPDATE session SET expires_at=$2 WHERE id=$1",
            [actor.sessionId, new Date(now).toISOString()],
          );
        if (kind === "absolute-expired")
          await f.fixturePool.query(
            "UPDATE session SET created_at=$2 WHERE id=$1",
            [actor.sessionId, new Date(now - 30 * 86400000).toISOString()],
          );
        await expect(create("new-church", subject)).rejects.toThrow(
          OnboardingDeniedError,
        );
        await none();
      },
    );
    it.each([
      { name: " " },
      { slug: "ab" },
      { addressLine1: " " },
      { countryCode: "de" },
      { denomination: "x".repeat(121) },
      { logo: "data:image/png,x" },
    ])("invalid input %# leaves zero artifacts", async (input) => {
      await expect(
        service.createChurch(actor, {
          name: "Church",
          slug: "church",
          ...input,
        }),
      ).rejects.toThrow("Invalid church details");
      await none();
    });
    it.each([
      "id",
      "status",
      "verificationState",
      "owner",
      "ownerMembershipId",
      "isPrimaryOwner",
      "roles",
      "permissions",
      "creatorUserId",
      "ownerUserId",
    ])("protected %s cannot influence onboarding", async (field) => {
      await expect(
        service.createChurch(actor, {
          name: "Church",
          slug: "church",
          [field]: stranger.userId,
        }),
      ).rejects.toThrow("Invalid church details");
      await none();
    });
    it("duplicate canonical slug returns safe conflict and leaves first church unchanged", async () => {
      const first = await create("New-Church");
      const before = JSON.stringify(
        (await f.fixturePool.query("SELECT * FROM church ORDER BY id")).rows,
      );
      await expect(create()).rejects.toThrow(ChurchSlugConflictError);
      expect(
        JSON.stringify(
          (await f.fixturePool.query("SELECT * FROM church ORDER BY id")).rows,
        ) === before,
      ).toBe(true);
      await complete(first.church.id);
      expect(await counts()).toEqual([1, 1, 4, 0, 0, 1, 1]);
    });
    it("concurrent same-slug creates exactly one complete winner with no losing artifacts", async () => {
      const results = await Promise.allSettled([
        create("same-church", actor, concurrent),
        create("same-church", actor, concurrent),
      ]);
      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected");
      expect(failure?.reason instanceof ChurchSlugConflictError).toBe(true);
      await complete(successes[0]!.value.church.id);
      expect(await counts()).toEqual([1, 1, 4, 0, 0, 1, 1]);
    });
    it("same creator may concurrently onboard different churches", async () => {
      const [a, b] = await Promise.all([
        create("church-one", actor, concurrent),
        create("church-two", actor, concurrent),
      ]);
      expect(a.church.id !== b.church.id).toBe(true);
      await complete(a.church.id);
      await complete(b.church.id);
      expect(await counts()).toEqual([2, 2, 8, 0, 0, 2, 2]);
    });
    it.each([
      "church",
      "church_membership",
      "church_primary_owner",
      "church_ownership_audit",
      "church_role",
    ])(
      "%s INSERT failure rolls back ALL artifacts with sanitized diagnostics",
      async (table) => {
        await f.fixturePool.query(
          `CREATE FUNCTION onboarding_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-provider-diagnostic'; END $$; CREATE TRIGGER onboarding_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION onboarding_failure()`,
        );
        try {
          await expect(create()).rejects.toThrow(/^Church onboarding failed$/);
          await none();
        } finally {
          await f.fixturePool.query(
            `DROP TRIGGER onboarding_failure ON "${table}"; DROP FUNCTION onboarding_failure()`,
          );
        }
      },
    );
    it("ownership denial return rolls back church and membership", async () => {
      vi.spyOn(owner, "establishInitialOwnerInTransaction").mockResolvedValue(
        "denied",
      );
      await expect(create()).rejects.toThrow("Church onboarding failed");
      await none();
    });
    it("failure after real role provisioning also rolls back already-written owner/audit/roles", async () => {
      const provision = roles.ensureStandardRolesInTransaction.bind(roles);
      vi.spyOn(roles, "ensureStandardRolesInTransaction").mockImplementation(
        async (ctx, tx) => {
          await provision(ctx, tx);
          throw new Error("private downstream failure");
        },
      );
      await expect(create()).rejects.toThrow(/^Church onboarding failed$/);
      await none();
    });
    it("post-onboarding foreign known IDs and mismatched tenant scopes disclose nothing", async () => {
      const a = await create("church-one"),
        b = await create("church-two", stranger);
      const A = TenantContext.fromAuthorizedScope(a.church.id),
        B = TenantContext.fromAuthorizedScope(b.church.id);
      await f.withTenant(A, async (tx) => {
        expect(await churches.getCurrentChurch(B, tx)).toBeNull();
        expect(
          await members.getRelationshipById(B, tx, b.membership.id),
        ).toBeNull();
        expect(await ownerRepo.current(B, tx)).toBeNull();
        expect(await ownerRepo.recentAudit(B, tx)).toEqual([]);
        expect(await rolesRepo.listRoles(B, tx)).toEqual([]);
        for (const table of tables.filter((t) => t !== "church"))
          expect(
            (
              await tx.execute(
                sql`SELECT * FROM ${sql.identifier(table)} WHERE church_id=${b.church.id}`,
              )
            ).rows,
          ).toEqual([]);
      });
      expect(await owner.isPrimaryOwner(B, actor)).toBe(false);
      await complete(a.church.id);
      await complete(b.church.id, stranger);
    });
    it("bootstrap enforces restricted runtime and cannot use migration-owner credentials", async () => {
      await f.assertRestrictedRole();
      const unsafe = build(
        f.fixtureDb,
        new TenantDatabase(f.fixtureDb),
      ).onboarding;
      await expect(create("new-church", actor, unsafe)).rejects.toThrow(
        /^Church onboarding failed$/,
      );
      await none();
    });
    it("clears local tenant context on commit and rollback with a reused connection", async () => {
      await create();
      await expect(create()).rejects.toThrow(ChurchSlugConflictError);
      expect((await f.runtimePool.query("SELECT * FROM church")).rows).toEqual(
        [],
      );
      const row = (
        await f.runtimePool.query(
          "SELECT nullif(current_setting('app.current_church_id',true),'') value",
        )
      ).rows[0];
      expect(row.value).toBeNull();
    });
    it("does not mutate sessions, assurance, identity, factor or role definitions; safe result only", async () => {
      const snapshot = async () =>
        JSON.stringify(
          await Promise.all(
            ['"user"', "session", "two_factor", "session_assurance"].map(
              async (table) =>
                (
                  await f.fixturePool.query(
                    "SELECT * FROM " + table + " ORDER BY 1",
                  )
                ).rows,
            ),
          ),
        );
      const before = await snapshot();
      const result = await create();
      expect((await snapshot()) === before).toBe(true);
      expect(Object.keys(result).sort()).toEqual([
        "church",
        "membership",
        "ownership",
      ]);
      expect(Object.keys(result.church).sort()).toEqual([
        "id",
        "name",
        "slug",
        "status",
        "verificationState",
      ]);
      expect(Object.keys(result.membership).sort()).toEqual(["id", "status"]);
      expect(
        (
          await f.fixturePool.query(
            "SELECT count(*)::int n FROM session_assurance",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("clean and repeated migrations stop at 0009 and preserve completed onboarding", async () => {
      const created = await create();
      const before = await counts();
      await migrateFixture(f.fixturePool);
      await migrateFixture(f.fixturePool);
      expect(await counts()).toEqual(before);
      await complete(created.church.id);
      expect(
        (
          await f.fixturePool.query(
            "SELECT count(*)::int n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0].n,
      ).toBe(10);
    });
  });
}
