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
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export const migrationsFolder = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
);
export async function migrateFixture(
  pool: Pool,
  throughTag?: string,
): Promise<void> {
  if (!throughTag) {
    await migrate(drizzle(pool), { migrationsFolder });
    return;
  }
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as {
    entries: { tag: string }[];
  };
  const end = journal.entries.findIndex((entry) => entry.tag === throughTag);
  if (end < 0) throw new Error("Unknown prior migration tag");
  journal.entries = journal.entries.slice(0, end + 1);
  if (journal.entries.some(({ tag }) => !/^\d{4}_[a-z0-9_]+$/.test(tag))) {
    throw new Error("Unsafe migration journal tag");
  }
  const cache = fileURLToPath(
    new URL("../../../../../.cache/", import.meta.url),
  );
  mkdirSync(cache, { recursive: true });
  const prior = mkdtempSync(join(cache, "tenant-prior-migrations-"));
  try {
    mkdirSync(join(prior, "meta"));
    writeFileSync(join(prior, "meta/_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries) {
      copyFileSync(
        join(migrationsFolder, tag + ".sql"),
        join(prior, tag + ".sql"),
      );
    }
    await migrate(drizzle(pool), { migrationsFolder: prior });
  } finally {
    const local = relative(resolve(cache), resolve(prior));
    if (!/^tenant-prior-migrations-[a-zA-Z0-9]+$/.test(local)) {
      throw new Error("Unsafe fixture cleanup path");
    }
    rmSync(prior, { recursive: true });
  }
}
