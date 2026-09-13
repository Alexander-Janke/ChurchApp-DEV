import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "./database.constants.js";
import type { Database, DatabaseTransaction } from "./database.types.js";
import * as schema from "./schema/index.js";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  // Infrastructure/repositories only. This is not an authorization boundary.
  // Future tenant repositories must require trusted context and use transaction().
  readonly db: Database;
  private shutdownPromise?: Promise<void>;
  private readonly logger = new Logger(DatabaseService.name);
  private readonly handlePoolError = () => {
    this.logger.error("Unexpected idle PostgreSQL connection error");
  };

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {
    this.pool.on("error", this.handlePoolError);
    this.db = drizzle(this.pool, { schema, logger: false });
  }

  // Infrastructure escape hatch: never return or retain the borrowed client.
  // Use transaction() for atomic work, not manual BEGIN/COMMIT here.
  async withClient<T>(
    work: (client: Pick<PoolClient, "query">) => Promise<T>,
  ): Promise<T> {
    return this.withConnection(work);
  }

  private async withConnection<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      return await work(client);
    } catch (error) {
      discard = true;
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async transaction<T>(
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    // Outer ownership guarantees release even if Drizzle's BEGIN fails.
    // All future transaction-local settings and queries must use this tx handle.
    return this.withConnection((client) =>
      drizzle(client, { schema, logger: false }).transaction(work),
    );
  }

  onModuleDestroy(): Promise<void> {
    this.shutdownPromise ??= Promise.resolve()
      .then(() => this.pool.end())
      .catch(() => {
        throw new Error("PostgreSQL pool shutdown failed");
      })
      .finally(() => {
        this.pool.removeListener("error", this.handlePoolError);
      });
    return this.shutdownPromise;
  }
}
