import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../database/schema/index.js";
import { createBetterAuth } from "./auth.config.js";

// CLI-only entry point: reuse application options without a pool or database I/O.
// Never import this instance into the running application; AuthModule owns that one.
export const auth = createBetterAuth(drizzle.mock({ schema }));
