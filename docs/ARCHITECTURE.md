# Church Platform – Technical Architecture

## 1. Purpose

This document defines the target technical architecture for the Church Platform.

It describes how the system should be structured and which architectural principles Codex must follow.

The architecture should support:

- iOS
- Android
- full web application
- church administration
- platform superadmin
- multi-tenancy
- real-time and asynchronous communication
- file and audio storage
- large numbers of users and churches
- gradual scaling
- low initial infrastructure cost
- strong privacy and security

The goal is:

Start simple and cost-efficient, while avoiding architectural decisions that prevent later scaling.

---

# 2. Architecture Philosophy

The platform should initially use a modular monolith.

Do not start with unnecessary microservices.

The modular monolith must still contain clearly separated application modules.

Examples:

- authentication
- users
- churches
- memberships
- permissions
- groups
- events
- duties
- notifications
- chat
- prayer
- sermons
- files
- children
- tasks
- billing
- administration

Module boundaries must be explicit.

Modules should communicate through defined service interfaces rather than directly accessing unrelated internals.

This allows selected modules to be separated into independent services later if scaling requires it.

---

# 3. Repository Architecture

Use a monorepo.

Target structure:

```text
church-platform/
│
├── AGENTS.md
├── README.md
│
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── PERMISSIONS.md
│   ├── TESTING.md
│   └── ROADMAP.md
│
├── apps/
│   ├── mobile/
│   ├── web/
│   └── admin/
│
├── services/
│   └── api/
│
├── packages/
│   ├── contracts/
│   ├── shared/
│   └── config/
│
├── infrastructure/
│   ├── docker/
│   ├── scripts/
│   └── netcup/
│
├── tests/
│   └── e2e/
│
└── .github/
    └── workflows/
```

The exact structure may evolve if there is a clear technical reason.

Large structural changes must be documented.

---

# 4. Mobile Application

The mobile application uses Flutter.

Targets:

- Android
- iOS

Use one shared Flutter codebase wherever reasonable.

Do not create separate native Android and iOS applications unless explicitly required later.

---

## 4.1 Flutter Architecture

Use a clear feature-oriented structure.

Example:

```text
apps/mobile/lib/
├── app/
├── core/
├── features/
│   ├── auth/
│   ├── home/
│   ├── feed/
│   ├── calendar/
│   ├── churches/
│   ├── events/
│   ├── groups/
│   ├── duties/
│   ├── prayer/
│   ├── bible/
│   ├── sermons/
│   ├── chat/
│   └── profile/
└── shared/
```

Keep:

- UI
- application state
- API communication
- domain logic

clearly separated.

Do not place important business rules only inside UI widgets.

Critical authorization always remains server-side.

---

# 5. Web Application

The member-facing web application uses:

- React
- Next.js

The web application should support the major functionality available to normal platform users.

Examples:

- Home
- Feed
- Calendar
- Churches
- Groups
- Events
- Duties
- Sermons
- Prayer
- Chat
- Profiles
- Administration where permitted

The web application is not only an administration panel.

It is a full user-facing platform.

---

# 6. Administration Applications

Administrative functionality exists at two levels.

## 6.1 Church Administration

Church administration may be integrated into the main web application.

It must remain role-based.

Examples:

- member administration
- events
- groups
- service planning
- roles
- church settings
- storage
- templates

---

## 6.2 Platform Superadmin

Platform superadministration should have a clearly separated administrative surface.

Target location:

```text
apps/admin/
```

Possible functionality:

- tenant management
- church verification
- SaaS plans
- platform settings
- support tools
- global templates
- system audit logs

Platform superadmins must not automatically gain unrestricted access to protected private content.

---

# 7. Backend

Use a central API-first backend.

Target location:

```text
services/api/
```

Both:

- mobile
- web

must use the same backend and business rules.

Do not duplicate important business logic independently in mobile and web clients.

---

# 8. Backend Technology

Use a modern server-side framework suitable for:

- TypeScript
- structured modules
- authentication
- validation
- background jobs
- testing
- PostgreSQL

The accepted backend is NestJS with TypeScript, using the standard Express adapter initially, within a modular monolith.

See [ADR 0001: Backend Framework](adr/0001-backend-framework.md) for the decision and architecture rules.

Avoid changing backend frameworks later without a strong architectural reason.

---

# 9. API Design

The backend exposes a versioned API.

Example:

```text
/api/v1/
```

API design should be consistent.

Protected endpoints must enforce:

- authentication
- the applicable tenant relationship/access policy (membership only where required)
- authorization
- input validation

The client must never be trusted to enforce security.

---

## 9.1 API Error Format

Use a consistent error structure.

Example concept:

```json
{
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "The requested event could not be found."
  }
}
```

Do not expose internal stack traces to clients.

---

## 9.2 Pagination

Potentially large result sets must use pagination.

Examples:

- members
- events
- sermons
- posts
- audit logs
- messages

Do not load unlimited rows into clients.

---

# 10. Database

Use PostgreSQL as the primary relational database.

PostgreSQL is the source of truth for structured application data.

The accepted access stack is Drizzle ORM with the `node-postgres` driver and Drizzle Kit migration tooling. See [ADR 0002: Database Access](adr/0002-database-access.md).

Examples:

- users
- churches
- memberships
- roles
- permissions
- events
- duties
- groups
- registrations
- tasks
- child relationships
- sermon metadata
- notification configuration

---

# 11. Database Migrations

All database schema changes must use versioned migrations.

Review generated migrations before application. Production must never use automatic schema synchronization. Use one controlled deployment migration step and separate migration/schema-owner credentials from runtime credentials, as specified in ADR 0002.

Never depend on manually edited production database structures.

Each migration must be:

- reproducible
- reviewable
- testable
- compatible with deployment procedures

Destructive migrations require special care.

---

# 12. Multi-Tenant Database Model

One church equals one tenant.

Tenant ownership must be explicit in the data model.

Tenant-owned tables must have explicit ownership, normally a non-null `church_id`, and RLS from the first real tenant-owned tables.

Conceptually:

```text
church_id
```

or equivalent tenant ownership must be identifiable.

---

## 12.1 Tenant Isolation

Tenant isolation must be enforced on the server.

Use application authorization, trusted server-created tenant context, explicit repository scoping, transaction-local PostgreSQL RLS, cross-tenant relationship constraints, and mandatory isolation tests. RLS supplements application authorization; it does not establish user entitlement. See [ADR 0006: Tenancy and Authorization](adr/0006-tenancy-and-authorization.md).

Example:

A user who belongs only to Church A must not be able to retrieve a protected member-only event in Church B:

```text
/api/v1/churches/B/events/123
```

even if the user manually changes the URL or request body.

Client-supplied tenant identifiers are never sufficient proof of authorization.

Church-related resources may be public, authenticated-user, follower, member, object-authorized, or administratively protected. Public/follower access must not be blocked by blanket membership checks. Non-tenant private resources require their own ownership/participant policies, not synthetic church IDs.

---

## 12.2 Platform-Level Entities

Some entities are platform-wide.

Examples:

- user account
- authentication identity
- personal profile
- friendship/contact relationships
- personal notification defaults

Church-specific relationships remain tenant-scoped.

---

# 13. Authentication

Accepted: Better Auth encapsulated behind the application-owned NestJS AuthModule. Domain modules depend on application authentication abstractions; authorization and security policy remain application-owned. See [ADR 0003: Authentication and Sessions](adr/0003-authentication-and-sessions.md).

Use one central authentication system for:

- mobile
- member web
- administration

Supported login methods initially:

- email/password
- Google
- Apple

Email verification is mandatory.

Social-only users need no local password. Account linking is explicit and requires recent authentication; email equality alone is insufficient. Mandatory TOTP/assurance requirements apply to effective privileged capabilities, including custom roles and every sign-in method.

The architecture must support:

- password reset
- email address change
- session management
- device sessions
- logout from individual devices
- logout from all other devices
- 2FA

Task 1.1 establishes the application-owned NestJS authentication boundary.
Task 1.2 adds the canonical Better Auth 1.7.4 `user`, `session`, `account`, and
`verification` tables in PostgreSQL's `public` namespace. These are platform-global
identities/security records, not church-owned resources: no `church_id` or tenant
RLS applies. Future membership tables will reference the global user identity.

Better Auth's pinned `auth@1.7.4` generator is authoritative for its fields and
relations in `services/api/src/database/schema/auth.ts`; the existing schema index
exports them. The Drizzle adapter receives this schema explicitly, with canonical
model names and default schema validation restored. That validation checks Drizzle
metadata; real PostgreSQL integration tests also verify the migrated database.
Application-owned, reviewed Drizzle migrations in `services/api/migrations` remain
the only schema deployment mechanism. No automatic migration occurs at startup.

For regeneration, from `services/api`, supply explicit non-production
`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` values to the process and run:

```text
pnpm dlx auth@1.7.4 generate --config ./src/auth/auth.schema.config.ts --output ../../.cache/auth-schema-review/auth.ts --adapter drizzle --dialect postgresql --yes
```

Create the ignored review directory first. The CLI-only configuration reuses the
application factory with `drizzle.mock`, so generation needs no pool, connection,
or database writes. Review the output before replacing the canonical schema;
then use `pnpm db:generate` with the existing Drizzle configuration and review the
SQL before `pnpm db:migrate`. Do not use Better Auth's direct migration command.
The pinned generator was run twice with identical output. No generator dependency
is added to the application. One-off pnpm cache/store overrides may keep CLI
artifacts in the repository's ignored caches without changing workspace settings.

Preserve generator semantics: text primary keys, unique user email/session token,
and non-unique verification identifier lookup. The generated account table has a
user index but no composite `(provider_id, account_id)` uniqueness constraint;
Better Auth 1.7.4 rejects ambiguous identity lookups at runtime. Review concurrency
and provider identity integrity before enabling account-creation/linking flows;
do not assume database-enforced provider uniqueness. Generated timestamps are
without time zone, and `$onUpdate` is Drizzle behavior, not a database trigger.
Task 1.3 enables canonical backend email/password registration at
`POST /api/v1/auth/sign-up/email`, with email verification required before password
sign-in. Signup accepts `name`, `email`, `password`, and optional `callbackURL`;
an application-owned Better Auth hook rejects other fields before database writes.
No custom signup controller or schema fields are introduced.

`AuthEmailSender` is the provider-neutral verification-delivery port, injected into
the single AuthModule-owned Better Auth instance. The default unavailable sender
rejects signup and verification-email requests with HTTP 503 before database writes,
including in development and production. Local automated tests explicitly inject
`TestAuthEmailSender`, which captures messages only in test-process memory and can
be reset. No production provider, console-email transport, or token file exists.
Manual development signup awaits a safe delivery implementation.

Accepted for Task 1.3: Better Auth 1.7.4 uses signed, short-lived JWT-formatted
email-verification links. The token contains the email claim and is signed with
Better Auth's secret; signature and expiry are verified server-side. This flow
neither stores nor consumes a `verification`-table record. Repeat still-valid links
for an already verified email return safe, idempotent success. The canonical
`verification` table remains unchanged for other Better Auth verification flows.
No custom verification mechanism is added.

Verification tokens are not authentication sessions and do not violate ADR 0003:
normal application sessions remain opaque server-side PostgreSQL sessions. No JWT
session/access-token/refresh-token architecture or JWT plugin is used. Signup and
verification do not auto-sign-in.
Frontend signup/login, final session policy, and other authentication flows remain
deferred. The pinned generator produces the unchanged Task 1.2 schema.

---

# 14. Sessions

Use PostgreSQL-backed server-side sessions with opaque credentials: HttpOnly browser cookies and securely stored mobile bearer credentials. Do not introduce an application JWT access/refresh architecture. ADR 0003 defines authoritative revocation, web/mobile lifetimes, administrative elevation, and five-minute critical-operation step-up. Successful password reset revokes all existing sessions.

Users may have multiple active sessions.

Session information should support:

- device/browser
- last activity
- approximate location where available and appropriate
- revocation

Critical session operations must be server-controlled.

Do not store long-lived sensitive credentials insecurely in clients.

---

# 15. Authorization

Use role-based access control with additional contextual authorization where needed.

Authorization is not just a frontend concern.

Every protected backend operation must determine:

1. Who is the user?
2. Which tenant or non-tenant resource scope is involved?
3. Does the user satisfy the applicable relationship/access policy?
4. Which roles does the user have?
5. Does the user have the required permission?
6. Does additional object-level authorization apply?

Detailed authorization rules are defined in:

`docs/PERMISSIONS.md`

---

# 16. Object Storage

Files must not be stored directly inside PostgreSQL.

Use S3-compatible object storage behind an application-owned abstraction, with replaceable provider adapters. Production storage should be EU-hosted and independent of the application container filesystem. See [ADR 0004: Object Storage](adr/0004-object-storage.md).

Examples:

- images
- PDFs
- documents
- group files
- task attachments
- sermon audio

PostgreSQL stores authoritative file metadata, object references, and authorization relationships. Object keys are not authorization. Garage is the preferred initial local S3-compatible candidate when storage behavior is needed, subject to compatibility verification; application code must not depend on Garage-specific APIs.

---

# 17. File Access

Files are private by default unless explicitly public.

File downloads must verify access permissions.

Do not assume that possession of an object URL grants authorization.

Where necessary use:

- authenticated download endpoints
- temporary signed URLs
- short-lived access URLs

Public assets may use public delivery where explicitly intended.

Private signed URLs are short-lived bearer grants, not user-bound authorization. Use authenticated delivery when current-user checks or immediate revocation are required, especially for highly sensitive files; see ADR 0004.

---

# 18. Media

Uploaded sermon audio uses object storage.

Sermon audio has a separate logical quota from general church storage. Exact plan limits remain deferred.

Direct uploaded video hosting is not part of V1.

Video content uses external providers such as YouTube links.

This reduces:

- storage requirements
- bandwidth cost
- media processing complexity

---

# 19. Cache

Redis or an equivalent key-value system may be used for:

- caching
- rate limiting
- distributed locks
- temporary application state
- queues where appropriate

Do not add Redis simply because it exists in the architecture.

Use it where it solves a real need.

Redis is not required solely for realtime. Do not initially use it as an authorization/private-data cache or session source of truth; PostgreSQL sessions remain authoritative. A Socket.IO Redis adapter is a later horizontal-scaling option under ADR 0005.

---

## 19.1 Cache Security

Cached data must never leak between tenants.

Cache keys must include the correct tenant and permission context where necessary.

Do not cache sensitive authorization results in unsafe ways.

---

# 20. Background Jobs

Slow or asynchronous operations should run through background workers.

Examples:

- email delivery
- push notification delivery
- imports
- media processing
- scheduled feed publication
- message reminders
- notification fan-out
- church deletion processing
- account deletion processing

---

## 20.1 Background Job Requirements

Jobs should be:

- idempotent where possible
- retry-safe
- observable
- logged
- failure-aware

Failed jobs must not silently disappear.

Use retry policies.

Repeated execution must not accidentally create duplicate side effects.

---

# 21. Notifications

Notification generation belongs to the backend.

Supported channels may include:

- in-app notification
- push notification
- email

The backend determines whether a notification event should be generated.

User preferences determine which delivery channels are used where permitted.

Security-critical notifications may bypass optional notification preferences.

---

# 22. Push Notifications

Mobile push notifications should use the appropriate Apple and Google push infrastructure.

The backend manages device tokens.

Device tokens must be:

- associated with a user/session
- revocable
- cleaned up when invalid

Do not treat push notifications as guaranteed delivery.

Important application state must remain visible in the application itself.

---

# 23. Email

Transactional email is sent by the backend.

Examples:

- email verification
- password reset
- security notifications
- important church messages
- system notifications

Use a centralized email abstraction so the provider can be changed later.

Do not tightly couple application logic to one email provider.

---

# 24. Realtime Communication

Chat and selected live updates may require realtime communication.

Accepted: Socket.IO through NestJS gateways in the modular monolith when a feature needs realtime. Gateways reuse application/domain authorization; they must not create a separate permission system. See [ADR 0005: Realtime](adr/0005-realtime.md).

REST/API and PostgreSQL remain authoritative for durable history/state. Clients recover state through the API after reconnecting. No separate realtime microservice or Redis dependency is required initially; horizontal scaling may later justify the Socket.IO Redis adapter.

---

# 25. Search

Initial search should remain technically simple.

Use PostgreSQL search capabilities where sufficient.

Examples:

- church search
- member search
- sermons
- events

Do not introduce a dedicated Elasticsearch/OpenSearch cluster prematurely.

A dedicated search service can be added later if:

- search volume
- ranking requirements
- indexing complexity

justify it.

---

# 26. Global Search Authorization

Search results must use the same authorization model as normal data access.

Never:

1. search all records
2. return restricted matches
3. rely on the UI to hide them

Authorization must be enforced during selection, not by retrieving broad cross-tenant data and filtering it afterward in application memory.

---

# 27. Offline and Local Caching

The mobile application should tolerate temporary poor connectivity.

Already-loaded non-sensitive information may be cached locally.

Examples:

- calendar
- recent posts
- accepted duties

Sensitive write operations should generally require confirmed server communication.

Do not create uncontrolled offline conflict resolution in V1.

---

# 28. API Contracts

Where useful, define shared API contracts in:

```text
packages/contracts/
```

TypeScript applications may consume the package for consistency between the
backend, main web application, and platform-admin application. Flutter does
not import TypeScript; its language-neutral boundary is the versioned
HTTP/OpenAPI API.

Do not expose internal database models directly as public API contracts.

API DTOs/contracts should be explicit.

---

# 29. Shared Code

Use:

```text
packages/shared/
```

only for genuinely shared code.

Avoid creating a large miscellaneous shared package.

Shared code may include:

- constants
- common schemas
- shared types
- selected utilities

Business logic should remain inside the appropriate domain module.

---

# 30. Infrastructure

Infrastructure configuration belongs under:

```text
infrastructure/
```

Target structure may include:

```text
infrastructure/
├── docker/
├── scripts/
└── netcup/
```

Infrastructure should be reproducible.

Avoid production configuration that only exists as undocumented manual server changes.

---

# 31. Containers

Use Docker for backend infrastructure and for deployable application images.

The initial application image foundation consists of:

```text
services/api/Dockerfile   API container, internal port 3001
apps/web/Dockerfile       Web container, internal port 3000
apps/admin/Dockerfile     Admin container, internal port 3002
```

The API, web, and platform-admin images use multi-stage builds and run as
non-root Node users. The API receives database configuration at runtime and
does not run migrations or seed data during image build or container startup.
Flutter remains a native Android/iOS application and is not containerized.

These Dockerfiles establish image foundations only. Production orchestration,
reverse proxy, TLS, registry, and deployment procedures are documented later.

Initial services may include:

```text
API
Worker
PostgreSQL
Redis
Reverse Proxy
```

Object storage may run separately depending on the selected provider.

Local development should use containers where useful for infrastructure dependencies.

---

# 32. Initial Hosting Strategy

The project should initially be hosted as cost-efficiently as practical.

Preferred initial hosting provider:

netcup

Preferred general principle:

Use a small number of affordable resources first.

Do not begin with an expensive distributed architecture.

---

# 33. Initial Production Topology

A practical early production setup may contain:

```text
Internet
   |
Reverse Proxy
   |
   +---- Web
   |
   +---- API
           |
           +---- PostgreSQL
           |
           +---- Redis
           |
           +---- Worker
           |
           +---- Object Storage
```

Exact deployment topology will be documented before production deployment.

---

# 34. Development Environments

Use separate environments.

At minimum:

- development
- staging
- production

---

## 34.1 Development

Used for local development.

May use:

- local Docker containers
- local database
- test accounts
- local object storage emulator or development storage

Never use real production personal data in local development.

---

## 34.2 Staging

Staging should resemble production closely enough for realistic tests.

Used for:

- integration testing
- end-to-end testing
- deployment verification
- manual acceptance testing

Use synthetic/test data.

---

## 34.3 Production

Contains real user data.

Production credentials and infrastructure access must be strictly limited.

Codex must not receive unrestricted production credentials.

---

# 35. Configuration

Application configuration must use environment-specific configuration.

Examples:

```text
DATABASE_URL
REDIS_URL
OBJECT_STORAGE_ENDPOINT
EMAIL_PROVIDER_CONFIG
AUTH_CONFIG
```

Secrets must not be committed to Git.

Provide safe templates such as:

```text
.env.example
```

without real credentials.

---

# 36. CI

GitHub Actions should be used for continuous integration.

Every relevant pull request should run automated checks.

The exact workflow will be defined in:

`docs/TESTING.md`

Possible checks:

- formatting
- linting
- static analysis
- unit tests
- integration tests
- database migration tests
- tenant isolation tests
- web build
- Flutter tests
- backend build
- security checks

---

# 37. CD

Deployment should gradually become automated.

Desired flow:

```text
Commit / Pull Request
        ↓
Automated Tests
        ↓
Review
        ↓
Merge
        ↓
Automatic Staging Deployment
        ↓
Staging Verification
        ↓
Manual Production Approval
        ↓
Production Deployment
```

Production deployment should initially require explicit human approval.

---

# 38. Observability

Production systems require observability.

At minimum consider:

- application logs
- structured errors
- service health
- job failures
- performance metrics
- database health
- uptime monitoring

Do not log confidential personal data unnecessarily.

---

# 39. Error Tracking

Frontend and backend errors should be captured through a centralized error tracking system.

The exact provider may be selected later.

Error tracking must avoid exposing:

- passwords
- authentication tokens
- private messages
- highly sensitive personal data

---

# 40. Health Checks

Services should expose safe health endpoints.

Examples:

```text
/health
/ready
```

Health checks must not reveal sensitive system configuration.

---

# 41. Backups

The PostgreSQL database requires automatic daily backups.

Backups must support multiple restore points.

Backup procedures must be documented.

A backup is only valuable if restoration works.

Therefore restoration must be tested periodically.

---

# 42. Object Storage Backups

Important uploaded files must also have an appropriate backup or redundancy strategy.

Database backups alone are insufficient if object storage contains:

- sermon audio
- documents
- event attachments
- images

---

# 43. High Availability

Initial infrastructure may not need full enterprise-level high availability.

However the architecture must allow gradual improvement.

Possible future steps:

- separate database host
- replicated database
- multiple API instances
- load balancing
- separate worker nodes
- dedicated Redis
- dedicated object storage
- failover infrastructure

Do not introduce these prematurely.

---

# 44. Scalability

The application should scale horizontally where reasonable.

API instances should avoid unnecessary local state.

Long-running work should move to workers.

Files should live outside application containers.

Sessions should not depend solely on one server process.

---

# 45. Performance

Use efficient database access.

Important considerations:

- indexes
- pagination
- query limits
- batching
- avoiding N+1 queries
- appropriate transactions
- avoiding loading unnecessary fields

Performance should be measured rather than guessed.

---

# 46. Database Indexing

Indexes should reflect real query patterns.

Likely important index categories include:

- tenant ownership
- user relationships
- church membership
- event dates
- duty dates
- membership status
- notification state
- message timestamps

Do not add excessive indexes without reason.

---

# 47. Transactions

Use database transactions for operations that must remain consistent.

Examples:

- accepting membership and creating related church relationship state
- moving someone from waitlist into event
- changing Primary Owner
- completing sensitive multi-step administrative operations

Partial completion of these operations should not leave invalid data.

---

# 48. Concurrency

The system must consider concurrent requests.

Examples:

- two users taking the final event slot
- two users claiming the final volunteer need
- two administrators assigning the same duty
- waitlist advancement

Use transactions, locking, or database constraints as appropriate.

Do not rely only on frontend checks.

---

# 49. IDs

Use non-guessable public identifiers where appropriate.

Do not make sensitive resources vulnerable because IDs are sequential and easily enumerable.

Authorization remains mandatory regardless of identifier format.

---

# 50. Time and Dates

Store server timestamps consistently.

Prefer UTC for backend timestamps.

Convert to the user’s locale/time zone at presentation boundaries.

Events must support the relevant event time zone.

Do not silently assume every user or church uses the server time zone.

---

# 51. Internationalization Architecture

All application UI must support:

- German
- English
- Portuguese

Translation keys should be stable.

Do not hardcode translated strings throughout business logic.

User-generated church content remains stored in the language entered by the author.

Automatic translation is not part of V1.

---

# 52. Accessibility Architecture

Reusable UI components should support accessibility by default.

Web:

- semantic HTML
- keyboard navigation
- visible focus states
- screen reader labels

Flutter:

- semantics
- scalable text
- appropriate touch target sizes

Accessibility should be built into shared components rather than added only at the end.

---

# 53. Design System

The applications should use reusable design components.

Examples:

- buttons
- cards
- dialogs
- forms
- navigation
- status indicators
- avatars
- empty states
- error states
- loading states

Do not create visually inconsistent custom controls for every feature.

---

# 54. Audit Architecture

Critical administrative actions generate audit events.

Audit records should identify where appropriate:

- actor
- tenant
- action
- affected resource
- timestamp
- relevant change metadata

Audit events must be append-oriented.

Avoid silently rewriting audit history.

Detailed requirements belong in:

`docs/SECURITY.md`

---

# 55. Sensitive Data Access

Highly sensitive data may require access logging in addition to change logging.

Example:

Viewing a child's medical or allergy information.

Sensitive access events must be designed intentionally.

Do not globally log every database read.

---

# 56. Data Deletion

Deletion processes may require delayed background processing.

Examples:

- account deletion after three-month transition period
- church deletion after 30-day protection period

Deletion jobs should be safe, traceable, and repeatable.

Historical data may need anonymization rather than deletion.

---

# 57. Rate Limiting

Sensitive and public endpoints should support rate limiting where appropriate.

Examples:

- login
- password reset
- registration
- church search
- membership requests
- reporting
- public endpoints

Rate limiting may use Redis or equivalent infrastructure.

---

# 58. Security Boundaries

Do not expose internal services directly to the public internet unless required.

Production databases and Redis should not be publicly reachable without strong justification.

Prefer private/internal networking where available.

---

# 59. Deployment Portability

The platform should initially prefer netcup but must not be irreversibly tied to netcup-specific services.

Deployment should remain portable.

Prefer:

- containers
- standard PostgreSQL
- S3-compatible storage
- standard Redis-compatible systems
- standard reverse proxy technology

This allows migration to another EU infrastructure provider later.

---

# 60. Architecture Decision Records

Important architectural choices should be documented.

Create an ADR when a decision has significant long-term impact.

Suggested location:

```text
docs/adr/
```

ADR sequence (accepted records and planned decisions):

```text
0001-backend-framework.md
0002-database-access.md
0003-authentication-and-sessions.md
0004-object-storage.md
0005-realtime.md
0006-tenancy-and-authorization.md
```

Do not create ADRs for trivial implementation details.

---

# 61. What Must Not Happen

Codex must not introduce the following without an explicit architecture decision:

- unnecessary microservices
- separate databases per module
- multiple competing frontend frameworks
- direct client database access
- authorization only in the frontend
- hardcoded production credentials
- public PostgreSQL access
- public Redis access
- direct uploaded video infrastructure
- Kubernetes solely because the application uses containers
- Elasticsearch/OpenSearch before there is a demonstrated need
- multiple sources of truth for user identity
- duplicated business logic across mobile and web

---

# 62. Architecture Decision Priority

When multiple technical approaches are valid, prefer:

1. security
2. correctness
3. simplicity
4. maintainability
5. developer productivity
6. low operating cost
7. performance
8. future scalability

Do not solve hypothetical future scale problems by making V1 unnecessarily complex.

---

# 63. Relationship to Other Documents

Product behavior:

`docs/PRODUCT.md`

Authorization:

`docs/PERMISSIONS.md`

Security and privacy:

`docs/SECURITY.md`

Testing:

`docs/TESTING.md`

Implementation order:

`docs/ROADMAP.md`

This document defines technical architecture.

It does not override explicit product requirements.

---

# 64. Architecture Change Rule

Codex may make small implementation-level architectural decisions when necessary.

Codex must not silently change major architectural principles.

For major changes such as:

- replacing PostgreSQL
- replacing Flutter
- changing multi-tenancy strategy
- introducing microservices
- replacing the central API architecture
- introducing a new major infrastructure dependency

Codex must:

1. explain the reason
2. identify alternatives
3. document tradeoffs
4. wait for an explicit project decision before proceeding
