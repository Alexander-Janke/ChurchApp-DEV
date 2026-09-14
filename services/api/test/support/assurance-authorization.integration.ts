import { randomUUID, randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { AuthorizationRepository } from "../../src/authorization/authorization.repository.js";
import { SessionAuthorizationService } from "../../src/authorization/session-authorization.service.js";
import { SessionAssuranceService } from "../../src/auth/session-assurance.service.js";
import { MembershipRepository } from "../../src/membership/membership.repository.js";
import {
  createTenantTestFixture,
  type TenantTestFixture,
} from "./tenant/database-fixture.js";
import {
  baseTenantFixtures,
  seedTenantFixtures,
} from "./tenant/tenant-fixtures.js";
import { issueTestAssurance } from "./assurance.integration.js";

export function assuranceAuthorizationIntegrationTests() {
  describe("combined permission and assurance boundary through restricted tenant RLS", () => {
    const base = baseTenantFixtures(),
      A = base.tenantA.context,
      B = base.tenantB.context;
    const roleId = randomUUID();
    const actor = { userId: base.userA.userId, sessionId: randomUUID() };
    const other = { userId: base.userB.userId, sessionId: randomUUID() };
    const repo = new AuthorizationRepository(),
      memberships = new MembershipRepository();
    let fixture: TenantTestFixture, service: SessionAuthorizationService;
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
      // Exact non-secret global columns needed alongside tenant-bound RLS checks.
      await fixture.fixturePool.query(
        `GRANT SELECT(id,user_id,created_at,expires_at) ON session TO "${fixture.roleName}"`,
      );
      await fixture.fixturePool.query(
        `GRANT SELECT ON session_assurance TO "${fixture.roleName}"`,
      );
      service = new SessionAuthorizationService(
        fixture.tenantDatabase,
        repo,
        new SessionAssuranceService(fixture.runtimeDb),
      );
    }, 30000);
    afterAll(async () => {
      await fixture?.dispose();
    });
    beforeEach(async () => {
      await seedTenantFixtures(fixture.fixturePool, base, {
        memberships: true,
      });
      await fixture.fixturePool.query(
        "insert into church_role(id,church_id,name) values($1,$2,'Test role')",
        [roleId, A.churchId],
      );
      await fixture.fixturePool.query(
        "insert into church_role_permission(church_id,role_id,permission) values($1,$2,'members.view'),($1,$2,'events.create')",
        [A.churchId, roleId],
      );
      await fixture.fixturePool.query(
        "insert into church_membership_role(church_id,membership_id,role_id) values($1,$2,$3)",
        [A.churchId, base.relationshipA.id, roleId],
      );
      for (const subject of [actor, other])
        await fixture.fixturePool.query(
          "insert into session(id,user_id,token,created_at,updated_at,expires_at) values($1,$2,$3,now()-interval '1 minute',now(),now()+interval '1 day')",
          [subject.sessionId, subject.userId, randomBytes(32).toString("hex")],
        );
      await issueTestAssurance(fixture.fixturePool, actor.sessionId);
    });
    it("current member succeeds only in own tenant; assurance cannot grant access to B", async () => {
      await fixture.assertRestrictedRole();
      expect(await service.isAuthorized(A, actor, "events.create")).toBe(true);
      expect(await service.isAuthorized(B, actor, "events.create")).toBe(false);
      expect(await service.isAuthorized(A, other, "events.create")).toBe(false);
      expect(
        await service.isAuthorized(
          A,
          { userId: actor.userId, sessionId: other.sessionId },
          "events.create",
        ),
      ).toBe(false);
    });
    it("inactive eligibility and left status immediately override existing assurance", async () => {
      await fixture.withTenant(A, (tx) =>
        memberships.changeRelationshipStatus(
          A,
          tx,
          base.relationshipA.id,
          "member",
          "inactive",
        ),
      );
      expect(await service.isAuthorized(A, actor, "events.create")).toBe(false);
      expect(await service.isAuthorized(A, actor, "members.view")).toBe(true);
      await fixture.withTenant(A, (tx) =>
        memberships.changeRelationshipStatus(
          A,
          tx,
          base.relationshipA.id,
          "inactive",
          "member",
        ),
      );
      expect(await service.isAuthorized(A, actor, "events.create")).toBe(true);
      await fixture.withTenant(A, (tx) =>
        memberships.changeRelationshipStatus(
          A,
          tx,
          base.relationshipA.id,
          "member",
          "left",
        ),
      );
      expect(await service.isAuthorized(A, actor, "members.view")).toBe(false);
    });
    it("follower with an assigned role and assurance still receives no role permissions", async () => {
      await fixture.fixturePool.query(
        "insert into church_role(id,church_id,name) values('follower-role',$1,'Fixture follower')",
        [B.churchId],
      );
      await fixture.fixturePool.query(
        "insert into church_role_permission(church_id,role_id,permission) values($1,'follower-role','members.view')",
        [B.churchId],
      );
      await fixture.fixturePool.query(
        "insert into church_membership_role(church_id,membership_id,role_id) values($1,$2,'follower-role')",
        [B.churchId, base.relationshipB.id],
      );
      await issueTestAssurance(fixture.fixturePool, other.sessionId);
      expect(await service.isAuthorized(B, other, "members.view")).toBe(false);
    });
    it.each(["assignment", "permission"])(
      "removing %s immediately denies without clearing assurance",
      async (kind) => {
        expect(await service.isAuthorized(A, actor, "events.create")).toBe(
          true,
        );
        await fixture.withTenant(A, (tx) =>
          kind === "assignment"
            ? repo.removeRole(A, tx, base.relationshipA.id, roleId)
            : repo.removeRolePermission(A, tx, roleId, "events.create"),
        );
        expect(await service.isAuthorized(A, actor, "events.create")).toBe(
          false,
        );
        expect(
          (
            await fixture.fixturePool.query(
              "select session_id from session_assurance where session_id=$1",
              [actor.sessionId],
            )
          ).rows,
        ).toHaveLength(1);
      },
    );
    it("unregistered privileged key and deleted session fail closed", async () => {
      expect(await service.isAuthorized(A, actor, "roles.manage")).toBe(false);
      await fixture.fixturePool.query("delete from session where id=$1", [
        actor.sessionId,
      ]);
      expect(await service.isAuthorized(A, actor, "events.create")).toBe(false);
    });
  });
}
