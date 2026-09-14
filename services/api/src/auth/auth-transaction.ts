import { AsyncLocalStorage } from "node:async_hooks";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type {
  Database,
  DatabaseTransaction,
} from "../database/database.types.js";
import type { DatabaseService } from "../database/database.service.js";
import * as schema from "../database/schema/auth.js";

// Application-owned Drizzle connection routing. The native Better Auth adapter
// object is unchanged, preserving its schema checks and supported API contract.
// No Better Auth internal context or adapter methods are replaced.
export class AuthTransaction {
  private readonly scope = new AsyncLocalStorage<DatabaseTransaction>();
  readonly adapter: ReturnType<typeof drizzleAdapter>;
  constructor(
    private readonly database: Database,
    private readonly transact: DatabaseService["transaction"] = (work) =>
      database.transaction(work),
  ) {
    // Drizzle database and transaction expose the same query-builder operations.
    // Resolve each operation in this request's async scope, never globally. Normal
    // auth calls outside explicit enrollment transactions still use the pool.
    const connection = new Proxy(database, {
      get: (_target, property) => {
        const target = this.scope.getStore() ?? database;
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    this.adapter = drizzleAdapter(connection, { provider: "pg", schema });
  }
  get db(): Database | DatabaseTransaction {
    return this.scope.getStore() ?? this.database;
  }
  run<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.transact((tx) => this.scope.run(tx, () => work(tx)));
  }
}
