export function getDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value?.trim()) throw new Error("DATABASE_URL is required");
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length <= 1
    ) {
      throw new Error();
    }
  } catch {
    // Never include the supplied URL or the parser's original error.
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL with a host and database",
    );
  }
  return value;
}
