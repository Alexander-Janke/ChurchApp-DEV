export function parseRoleId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !value ||
    value.trim() !== value
  )
    throw new Error("Invalid role or membership identifier");
  return value;
}
export function parseRoleName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value.trim()].length > 100
  )
    throw new Error("Invalid role name");
  return value.trim();
}
export function parseCustomRole(input: unknown): {
  name: string;
  description: string | null;
} {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "name" && key !== "description")
  )
    throw new Error("Invalid custom role");
  const data = input as Record<string, unknown>;
  const description = data.description ?? null;
  if (
    description !== null &&
    (typeof description !== "string" || [...description].length > 500)
  )
    throw new Error("Invalid role description");
  return { name: parseRoleName(data.name), description };
}
export function parseRolePage(limit: number, after?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid role page");
  return { limit, after: after === undefined ? undefined : parseRoleId(after) };
}
