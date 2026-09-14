// Server-only construction boundary, NOT an entitlement resolver.
// Only trusted authorization code may call fromAuthorizedScope after checking the
// operation's access policy. There is deliberately no HTTP resolver in Task 1.9.
export class TenantContext {
  readonly #trusted = true;
  private constructor(readonly churchId: string) {
    Object.freeze(this);
  }
  static fromAuthorizedScope(churchId: string): TenantContext {
    if (
      typeof churchId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        churchId,
      )
    )
      throw new Error("Invalid tenant scope");
    return new TenantContext(churchId);
  }
  static assert(value: unknown): asserts value is TenantContext {
    if (!(value instanceof TenantContext) || !(#trusted in value))
      throw new Error("Trusted tenant context required");
  }
}
