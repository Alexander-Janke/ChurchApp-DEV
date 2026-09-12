# ADR 0001: Backend Framework

## Status

Accepted

## Context

The Church Platform is a large SaaS application with many modules. It requires strict multi-tenancy, a role and permission system, contextual and object-level authorization, and protection of sensitive personal data, child information, and private communication.

One authoritative REST API must serve Flutter mobile clients and the Next.js web and administration clients. PostgreSQL is the primary database. Background jobs and realtime functionality will be introduced with the features that need them; Redis is used only when required.

The backend begins as a modular monolith in `services/api/`, consistent with [ARCHITECTURE.md](../ARCHITECTURE.md) sections 2 and 7-8. It must remain maintainable as the product grows and deployable on conventional Docker-based infrastructure, initially preferring netcup. Clear conventions help developers and Codex work on small, reviewable changes without inventing a different structure for each module.

This decision records the project owner's approved direction. It does not change product scope or authorize application scaffolding.

## Decision

Use:

- TypeScript for backend application code.
- NestJS as the backend application framework.
- The standard NestJS Express adapter initially.
- A modular monolith with explicit module boundaries.

NestJS provides application structure and dependency injection. It does not itself solve tenant isolation, authorization, database security, privacy, or session security. These remain explicit application responsibilities governed by [SECURITY.md](../SECURITY.md) and [PERMISSIONS.md](../PERMISSIONS.md).

### Express Adapter

The standard Express adapter is selected for simplicity, mature ecosystem compatibility, and lower initial integration risk. It is expected to provide sufficient performance for the initial scale; this is a planning assumption to validate with real workloads, not a benchmark result.

Avoid premature optimization. A future migration to NestJS's Fastify adapter may be considered only when measurements or concrete technical requirements justify the integration and regression-testing cost. No adapter migration is currently planned.

## Architecture Rules

### Controllers

- Translate HTTP requests into application calls and map results to explicit response DTOs.
- Use explicit request DTOs and runtime input validation at the HTTP boundary.
- Remain thin; substantial business logic belongs in services.
- Do not access the database directly or receive unrestricted database access.
- Do not serialize database entities directly as public responses.

### Application/Domain Services

- Implement use cases and enforce business rules.
- Coordinate authorization and module-owned repositories.
- Coordinate transaction boundaries where operations must succeed atomically.
- Keep domain rules separate from HTTP details so the same rules can be reused by other entry points.
- Preserve the required security context when invoking another module's public service.

### Authorization

NestJS guards may enforce coarse checks such as an authenticated session or general route prerequisites. Guards must not be the only authorization layer.

Application/service operations must also enforce tenant-level, object-level, contextual, and sensitive-data authorization before protected access or side effects. A worker or realtime handler calling a service must not bypass checks because it did not pass through an HTTP guard.

Use centralized, reusable permission policies rather than scattered role-name comparisons. Validate tenant relationships server-side; a client-supplied tenant ID is never proof of access. Missing or ambiguous authorization must fail closed. Detailed tenant and permission mechanisms remain separate decisions and must follow the authoritative requirements.

### Database Access

Contain database access in module-owned repositories or data-access components. Controllers must not query the database, and modules must not reach into another module's tables through unrestricted database access.

The exact database-access technology is intentionally deferred to ADR 0002. This ADR does not select an ORM, query builder, migration tool, or database isolation mechanism. PostgreSQL safeguards, explicit tenant scoping, constraints, and transaction behavior still require deliberate design and testing.

### Modules

Use clear boundaries around cohesive responsibilities. Future modules may include authentication, users, churches, memberships, authorization, events, and groups. These are examples, not modules to create as part of this decision.

Modules expose intentional interfaces or services. Avoid arbitrary cross-module database access, circular dependencies, and large shared modules that accumulate unrelated business logic. Introduce modules incrementally according to the roadmap.

### API

The backend provides the authoritative business API for Flutter, Next.js web, and Next.js admin. All clients use the same server-side business and authorization rules.

Next.js must not become a second source of business rules or direct database access. Client-side validation and permission-aware UI improve usability but do not replace backend enforcement.

### Background Workers

Future workers should reuse the same domain/application modules where appropriate. A worker may run as a separate process or entry point from the same codebase; this remains part of the modular monolith and does not make the worker a separate microservice.

Workers must preserve tenant and authorization boundaries. Retry safety, idempotency, and failure handling remain required. Queue technology and worker implementation are deferred until separately decided and needed.

### Realtime

Future realtime functionality should initially remain within the modular backend. Realtime entry points must enforce current session, tenant, audience, and object access rules and account for permission revocation.

A separate realtime service requires a demonstrated scaling or operational need and an explicit architectural decision. [ADR 0005](0005-realtime.md) now records Socket.IO through NestJS gateways; implementation remains deferred until needed.

## Alternatives Considered

### Fastify with Custom Architecture

Fastify offers performance, plugin encapsulation, and flexibility. It could support the platform, but more project-specific architecture conventions would need to be designed and enforced manually.

The current project benefits more from NestJS's structural conventions for modules, dependency injection, and application services than from lower-level flexibility. Fastify with a custom architecture is therefore not selected initially.

### Hono

Hono is lightweight and simple, with runtime portability. For this large, authorization-heavy system, too much application architecture would need to be assembled and maintained manually.

Runtime portability is not currently a primary deployment requirement. Hono is therefore not selected.

### NestJS with Fastify Adapter

Using NestJS with its Fastify adapter remains technically possible and would retain the NestJS application structure. It is not necessary initially. Express is selected to minimize integration risk, with adapter review reserved for measured limitations or concrete requirements.

## Consequences

### Positive Consequences

- Consistent module structure and predictable dependency injection.
- Clear locations for authorization conventions and business rules.
- Application services that can be tested independently of HTTP delivery.
- Easier onboarding through a shared architectural vocabulary.
- Helpful structure for Codex-assisted development and focused reviews.
- Reuse of application rules across HTTP, future workers, and realtime entry points.

### Costs and Mitigations

- **Framework structure and boilerplate:** keep modules small and introduce abstractions only when needed; do not scaffold the entire product in advance.
- **Overly large modules:** keep responsibilities cohesive and review public interfaces as features grow.
- **Circular dependencies:** maintain clear dependency direction and resolve ownership problems instead of routinely working around cycles.
- **Business logic hidden in decorators, guards, or controllers:** keep use cases and resource policies in testable services; review alternate entry points for equivalent enforcement.
- **Framework coupling:** keep domain rules independent of NestJS and HTTP details where practical, while using NestJS for application composition. Do not build a second generic framework to hide every NestJS API.

## Security Considerations

NestJS is not a security boundary by itself. The application must explicitly implement:

- Server-side authorization, including contextual and object-level checks.
- Tenant isolation and server-verified tenant relationships.
- PostgreSQL safeguards and safe, scoped database access.
- Secure authentication and session handling, including required 2FA and step-up authentication.
- Sensitive-field response filtering and privacy protections.
- Runtime input validation and protection against mass assignment.
- Rate limiting where appropriate.
- Audit logging for critical operations and sensitive access where required.

Guard success does not authorize every object or field involved in an operation. Private messages, prayer content, personal Bible notes, and sensitive child data must retain their documented access restrictions; administrative rank must not create a universal bypass. Logs and errors must not expose secrets or private content.

## Testing Considerations

The backend structure must support unit tests, service/domain tests, integration tests, API tests, authorization tests, and tenant isolation tests. Use real PostgreSQL tests when database behavior matters, including constraints, transactions, concurrency, and isolation safeguards.

Follow [TESTING.md](../TESTING.md). Every protected feature needs positive and negative authorization coverage, including wrong tenant, wrong object scope, and revoked access where applicable. Every API, service, or repository accessing tenant-specific data must be covered by tests proving that Tenant A cannot access Tenant B's protected resources.

Authorization and tenant isolation failures block release. Service tests must verify security without depending solely on controller guards. Tests must use synthetic data and must not add production security bypasses.

The testing stack and its tooling will be finalized separately. This ADR does not select or install a test runner.

## Future Review Triggers

Reconsider the framework decision only for a concrete reason, such as:

- The framework becomes unsupported.
- Critical security or maintenance problems cannot reasonably be addressed.
- Major incompatibility with the required architecture is demonstrated.
- Measured performance limitations cannot reasonably be resolved within NestJS.
- Platform requirements fundamentally change.

A newer framework or a faster synthetic benchmark is not sufficient reason to reopen this decision. Any change requires documented evidence, alternatives, consequences, and explicit project-owner approval under [ARCHITECTURE.md](../ARCHITECTURE.md) section 64.
