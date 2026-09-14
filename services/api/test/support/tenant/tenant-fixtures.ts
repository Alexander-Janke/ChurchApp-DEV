import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { TenantContext } from "../../../src/database/tenant-context.js";

export function baseTenantFixtures() {
  const tenant = () => {
    const churchId = randomUUID();
    return { churchId, context: TenantContext.fromAuthorizedScope(churchId) };
  };
  return {
    tenantA: tenant(),
    tenantB: tenant(),
    userA: { userId: randomUUID() },
    userB: { userId: randomUUID() },
    relationshipA: { id: randomUUID() },
    relationshipB: { id: randomUUID() },
  };
}
export type BaseTenantFixtures = ReturnType<typeof baseTenantFixtures>;

// Privileged fixture setup, never an RLS assertion or an entitlement grant.
export async function seedTenantFixtures(
  fixturePool: Pool,
  fixtures: BaseTenantFixtures,
  options: { memberships?: boolean } = {},
): Promise<void> {
  const { tenantA, tenantB, userA, userB, relationshipA, relationshipB } =
    fixtures;
  await fixturePool.query("TRUNCATE church CASCADE");
  await fixturePool.query('DELETE FROM "user" WHERE id IN ($1,$2)', [
    userA.userId,
    userB.userId,
  ]);
  await fixturePool.query(
    'INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3),($4,$5,$6)',
    [
      userA.userId,
      "User A",
      "a@example.invalid",
      userB.userId,
      "User B",
      "b@example.invalid",
    ],
  );
  await fixturePool.query(
    "INSERT INTO church(id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)",
    [
      tenantA.churchId,
      "Church A",
      "church-a",
      tenantB.churchId,
      "Church B",
      "church-b",
    ],
  );
  if (options.memberships) {
    await fixturePool.query(
      "INSERT INTO church_membership(id,church_id,user_id,status) VALUES ($1,$2,$3,'member'),($4,$5,$6,'follower')",
      [
        relationshipA.id,
        tenantA.churchId,
        userA.userId,
        relationshipB.id,
        tenantB.churchId,
        userB.userId,
      ],
    );
  }
}
