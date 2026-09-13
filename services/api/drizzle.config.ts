import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url?.trim()) throw new Error("DATABASE_URL is required for Drizzle Kit");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url },
});
