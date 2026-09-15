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

`AuthEmailSender` is the provider-neutral authentication-email port, injected into
the single AuthModule-owned Better Auth instance. The default unavailable sender
rejects signup and verification-email requests with HTTP 503 before database writes,
including in development and production. Local automated tests explicitly inject
`TestAuthEmailSender`, which captures messages only in test-process memory and can
be reset. No production provider, console-email transport, or token file exists.
Manual development signup awaits a safe delivery implementation.

Task 1.5 adds distinct `sendPasswordReset` and `sendPasswordChanged` capabilities
to that port. The latter supplies the password-security notification required by
SECURITY.md; no provider SDK or general notification platform is introduced.

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
Frontend signup/login and other authentication flows remain deferred. Task 1.4
establishes only the normal web session policy below. The pinned generator produces
the unchanged Task 1.2 schema.

---

# 14. Sessions

Use PostgreSQL-backed server-side sessions with opaque credentials: HttpOnly browser cookies and securely stored mobile bearer credentials. Do not introduce an application JWT access/refresh architecture. ADR 0003 defines authoritative revocation, web/mobile lifetimes, administrative elevation, and five-minute critical-operation step-up. Successful password reset revokes all existing sessions.

Users may have multiple active sessions.

Task 1.4 uses canonical Better Auth password login at
`POST /api/v1/auth/sign-in/email` with verified email required. Accepted fields are
`email`, `password`, `callbackURL`, and `rememberMe`; unknown/protected fields are
rejected. Wrong passwords and unknown email addresses receive the same error.

Normal web sessions explicitly use `expiresIn=604800` (seven days) and
`updateAge=86400` (one day). Qualifying activity is successful native session
resolution that reaches Better Auth's refresh threshold. Requests before that
threshold do not write a new activity timestamp: expiry is seven days from the
last creation/qualifying refresh, rather than exactly seven days from every request.
`rememberMe=false` retains the library's shorter, non-rolling session behavior.
Neither cookie caching nor secondary storage is enabled.

`auth-session-policy.ts` owns the additional absolute limit using an injectable
clock function: `createdAt + 30 days <= now` is expired, even if `expiresAt` is later.
Supported before hooks run on HTTP and configured `auth.api` calls, resolve the
signed cookie through Better Auth, and delete expired rows before native middleware
can authorize or refresh them. Database failures fail closed with sanitized errors.
Future application consumers must use the configured AuthModule instance's API,
not raw library route functions or internal adapters as independent authenticators.
This adds a database lookup before native session resolution; no schema change,
background cleanup dependency, or custom session parser is introduced.

Canonical operations under `/api/v1/auth` are:

| Method/path | Behavior |
| --- | --- |
| `GET /get-session` | Current user/session metadata, or `null` when unauthenticated |
| `POST /sign-out` | Deletes current session and clears cookies; failed deletion cannot report success |
| `GET /list-sessions` | Own active metadata only; absolute-expired entries are deleted/omitted |
| `POST /revoke-session` | Application boundary accepts `{ "sessionId": "..." }`, resolves ownership, then invokes native token-based revocation |
| `POST /revoke-other-sessions` | Keeps current session, deletes other own sessions |
| `POST /revoke-sessions` | Deletes all own sessions, including the initiating session |

Unknown/foreign IDs on single revocation receive the same harmless success response;
raw-token management requests are rejected. Native session listing retains its
one-day fresh-session prerequisite, which can require signing in again. This is a
library endpoint restriction, not implementation of privileged assurance or step-up.
After hooks strip reusable credentials from login/current-session/list JSON and
mark responses `no-store`; browsers receive credentials only in HttpOnly cookies.
Session IDs remain non-secret management references. Native revocation performs
the database deletion and user scoping, with cross-user tests for every operation.

Mobile 30/90-day policy needs trusted server-side client classification and remains
deferred; a submitted client label cannot extend web lifetimes. Task 1.15 adds privileged elevation
and critical step-up storage/policy; production proof issuance and client
login/session-management UIs remain deferred.

Session information should support:

- device/browser
- last activity
- approximate location where available and appropriate
- revocation

Critical session operations must be server-controlled.

## Password change and recovery foundation (Task 1.5)

All routes remain Better Auth 1.7.4 endpoints under `/api/v1/auth`:

- `POST /change-password`: canonical `currentPassword`, `newPassword`, and optional
  `revokeOtherSessions`. Native current-password verification and scrypt hashing are
  retained. All new passwords reuse the shared 12–128 limits. The application rejects
  identical NFKC-normalized supplied passwords; native Better Auth allows reuse.
- Native `revokeOtherSessions=true` deletes the initiating session and creates a
  replacement. The before hook therefore always sets the native flag to false; the
  success hook mandates user-scoped deletion of all other sessions through Better
  Auth's adapter, regardless of the client's flag. The initiating ID, cookie and
  `createdAt` remain unchanged, including its Task 1.4 absolute expiry. This is not
  privileged elevation. Revocation failure returns an error rather than success.
- `POST /request-password-reset`: accepts `email` and `redirectTo`, checks delivery
  availability uniformly before lookup, then uses native generic responses for both
  existing and unknown email. Trusted-origin validation protects reset destinations.
- `POST /reset-password`: accepts `token` and `newPassword`, without requiring a
  session. Native reset consumes a one-hour record in `verification`, updates the
  existing credential and, with `revokeSessionsOnPasswordReset=true`, deletes all
  sessions belonging to that user. It does not auto-login. Other users are unaffected.

Reset records use `identifier=reset-password:<opaque token>` and `value=userId`;
this is distinct from stateless email-verification JWTs. Native atomic consumption
rejects invalid, expired, sequentially replayed and concurrently reused tokens.
The GET `/reset-password/:token` callback validates the trusted destination and
redirects there with the token; it does not consume it. The frontend destination
remains a placeholder, and its reset UI is not implemented.

Native reset can create a credential for an identity lacking one. An account-create
hook permits credential creation only during signup, blocking both reset and the
native server-only `setPassword` entry point: social-only password creation/linking remains
deferred. No schema, migration, dependency, OAuth or client change is required.

Reset delivery is dispatched without awaiting provider latency in the HTTP request.
The sender tracks pending promises, catches failures with a fixed sanitized error,
and drains them on graceful Nest shutdown. This is in-process work, not a durable
queue: process crashes can lose pending mail. Future providers need bounded I/O and
operational failure handling. Production/development without a real provider fail
closed; tests inject distinct in-memory verification/reset/notification captures.
Task 1.21b-0 wraps native password change/reset in the existing AuthTransaction
boundary. Password write, reset-token consumption where applicable, required
session revocation and durable authentication events commit on one connection.
Storage/audit failure rolls the operation back, including the reset token; no
successful response or password-change notification is issued. Notifications are
queued only after commit. Delivery remains in-process and can be lost on a crash;
this does not claim exactly-once mail delivery. Native password proof, hashing,
passwordless-account restrictions and the established session policy are retained.

Do not store long-lived sensitive credentials insecurely in clients.

---

## Application-owned email change (Task 1.6)

[ADR 0007](adr/0007-application-owned-email-change.md) replaces the rejected native
Better Auth 1.7.4 email-change flow with a user-ID-bound PostgreSQL workflow. Native
changeEmail stays explicitly disabled. Supported application-owned POST endpoints
under /api/v1/auth are /email-change/request (newEmail only),
/email-change/approve-current (token only), and /email-change/verify-new (token only).
They reuse Better Auth's router through an application-owned endpoint extension,
not a second login/session implementation.

The request derives user/session identity server-side and rechecks session validity.
Current-address approval is required for every account, then new-address verification.
One table stores immutable user binding, email snapshots, initiating-session snapshot,
state, hashes and timestamps. Only the final transaction changes the exact user's
email and emailVerified, consumes the token, marks completion and revokes other own
sessions. The valid initiating session keeps its original creation time; if missing
or expired, all own sessions are revoked. No session is created. Password, user ID
and credential/provider accounts remain unchanged; login uses the new email afterward.

The original one-hour deadline covers both phases. Both tokens are strictly single-use,
and latest request wins under user-first locks and a partial unique index. Hash lookup
never substitutes for immutable-user ownership checks. The custom table is exported
from the application schema index but excluded from Better Auth-owned generated
schema: the pinned generator must still reproduce auth.ts unchanged.

Approval/verification delivery failure rolls back the transition, allowing retry.
Completion notices to the old address run after commit and cannot undo identity changes.
Delivery is provider-neutral, bounded and tracked, but not crash-durable. Full failure,
rate-limit, frontend-fragment and upgrade-review details are in ADR 0007. No frontend,
OAuth linking, mobile policy or privileged assurance is implemented.

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

## Task 1.8: User Profile Backend Foundation

Task 1.8 implements Phase 1B as a global authenticated self-profile API:
`GET /api/v1/profile/me` and `PATCH /api/v1/profile/me`. There are no arbitrary-user
routes, directory, tenant relationships, administration, or client UI.

Better Auth's generated `user` remains the authentication identity. The separate
application-owned `user_profile` has a cascading primary-key/FK `user_id`, nullable
product fields, and a unique canonical username. Migration `0002_user_profile`
does not modify Better Auth's core schema. GET never creates a row; the first
successful PATCH creates one without synthesizing values from `user.name`.
Structured first/last names belong only to the profile; `user.name` retains its
auth/signup compatibility meaning with no synchronization. `user.image` remains
the only picture reference, not binary storage.

The framework-independent contracts are `SelfProfile`, `ProfileAddress`, and
`UpdateSelfProfileRequest`, exported through `@church-platform/contracts`.
Responses explicitly map identity ID/email/verification/image plus username,
structured names, date of birth, phone, address and biography. Timestamps are
unambiguous: `identityCreatedAt`, `profileCreatedAt`, `profileUpdatedAt` (the last
two are null before a profile exists). Dates of birth use YYYY-MM-DD; timestamps
use ISO instants. No internal auth rows or credentials are returned.

PATCH supports username, firstName, lastName, dateOfBirth, phoneNumber, address,
biography and image. Omitted fields remain unchanged; null clears a field.
An address object replaces the entire address, with omitted subfields cleared;
address=null clears all columns. An all-null address is returned as null.
Empty patches and unknown/protected fields are rejected. Username is lowercase
ASCII, 3–30 characters, with letters/digits and interior dot/underscore/hyphen.
Names are trimmed Unicode, nonempty when supplied, at most 100 code points.
Date of birth is a real nonfuture calendar date (UTC today boundary).
Phone is canonical E.164 syntax; country code is uppercase two-letter syntax,
without external country/address validation. Address limits are 200/200/32/120/120/2.
Biography preserves plain text/line breaks, up to 2000 Unicode code points.
Image is null or an HTTPS URL without embedded credentials, limited to 2048 code
points; the backend does not fetch it. Uploads and storage integration are deferred.

AuthModule exports a small application-owned session reader using its configured
Better Auth instance, so absolute expiry remains enforced and rolling cookie
headers are forwarded. Profile controllers stay thin; module-owned repositories
perform explicit user-ID-scoped queries and field mapping. PATCH locks the
identity and transacts profile upsert plus optional image update. Independent
field patches are preserved; same-field concurrent writes use last-commit-wins.
The database unique username index decides concurrent claims; conflicts return
409 without identifying the other user. Profile mutation does not touch accounts
or session rows; ordinary session resolution may still perform its configured
rolling refresh without resetting the absolute lifetime.

## Task 1.9: Church/Tenant Model & Isolation Foundation

Task 1.9 maps to Phase 1C. One church is one tenant: application-owned `church.id`
is the tenant key, with no separate tenant table. Future tenant children require
non-null `church_id` and appropriate ownership constraints. Better Auth identities,
email_change_request and user_profile retain their existing ownership.

The root uses application-generated random UUID text IDs; name is trimmed Unicode
(maximum 200 code points). Slugs are lowercase ASCII, 3–63 characters with interior
hyphens, enforced by a unique index and canonical check. No whitespace folding or
hyphen collapsing is performed. Complete reserved-slug validation belongs to Phase 2B;
no slug routes exist now. Nullable structured address limits match profile conventions
(200/200/32/120/120/2); countryCode uses uppercase two-letter syntax. Denomination is
nullable text limited to 120 code points. Logo is a nullable HTTPS reference (2048
characters, no embedded credentials); no backend fetch or upload exists. Lifecycle
status is active/inactive (default active), independently of verification state
unverified/pending/verified/rejected/revoked (default unverified). No public lifecycle
or verification transition API is implemented. Both timestamps are UTC instants.

ChurchModule is an internal, unmounted Nest module exporting ChurchService and
ChurchVerificationService, with no controllers or client contracts. Its repository requires both TenantContext and a
transaction handle and always predicates on church.id. Reads return internal data,
not a public DTO. Details updates explicitly map fields, never accept ID/status/
verification-state mutation, and replace nullable details as a complete internal
value. There is no unrestricted list or creation method.

TenantContext.fromAuthorizedScope is a server-only construction seam for future
trusted authorization code, not an entitlement check. The immutable runtime-branded
object cannot be replaced by deserialized JSON. The constructor validates UUID syntax
only; it must never be called from an HTTP tenant ID before checking entitlement.
No production caller currently creates a church context. Membership, permission,
object-policy and assurance checks remain prerequisites for future exposed operations.

TenantDatabase uses DatabaseService.transaction and the same Drizzle handle for
parameterized set_config('app.current_church_id', value, true) and every protected
query. It rejects superuser, BYPASSRLS, CREATEROLE, owner/owner-membership credentials,
or disabled/unforced RLS before setting scope. ChurchService owns this orchestration;
the lower-level repository never resets the supplied RLS context, so a repository-A/
database-B mismatch returns no data or mutation. Commit/rollback clears local context.

Migration 0003_church_tenant_foundation creates only church, its constraints/index,
ENABLE RLS and a policy with identical USING/WITH CHECK matching id to the nonempty
transaction-local setting. The explicit FORCE ROW LEVEL SECURITY statement is reviewed
PostgreSQL SQL because Drizzle does not represent FORCE in its snapshot. Preserve it
in migration history. Missing/invalid scope matches no row. No grants to PUBLIC or
runtime role creation are included in application migrations.

Local church_dev and CI postgres are privileged fixture/migration connections, not
valid tenant runtimes. The new test harness creates a unique disposable database
and a distinct LOGIN role with NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB,
no owner membership, and only CONNECT, schema USAGE, and church SELECT/INSERT/UPDATE/
DELETE grants. Protected assertions connect directly as that role; they never rely
on a superuser session pretending to be restricted. Before any tenant endpoint or
deployment, provision separate restricted runtime credentials and narrowly reviewed
grants for required tables. Existing local credentials will fail the tenant gate;
global auth/profile development behavior is unchanged.

## Task 1.10: Tenant Membership Foundation

Task 1.10 maps to Phase 1D. The application-owned `church_membership` represents
a platform user's relationship to a church, not an administrative role. Its six
required fields are opaque random UUID text `id`, text `church_id` and `user_id`,
text `status`, and timestamptz `created_at`/`updated_at`. Status is explicitly
supplied and constrained to follower, member, inactive or left. No state grants
administration or ownership. The global Better Auth user schema stays unchanged.

Both foreign keys cascade on deletion: a relationship cannot outlive either its
church or its global user. UNIQUE (church_id, user_id) permits multiple churches
per user but one retained relationship per pair. UNIQUE (church_id, id) supports
future tenant-safe composite foreign keys without adding a second identity.
The user_id index supports user-deletion cascades; tenant-prefixed indexes support
scoped lookup and pagination. No history, owner, role or workflow columns exist.

The unmounted MembershipModule exposes only an internal service. Creation derives
church_id from trusted TenantContext and accepts only userId/status. Reads select
relationship fields only, without joining private user data. ID/user lookups,
keyset pagination (default 50, maximum 100), and state updates always include an
explicit church_id predicate and use the existing TenantDatabase transaction.

A centralized transition boundary validates both expected and next state. All four
states are structurally representable; an expected-state conditional update prevents
a stale transition overwriting a concurrent change. Same-state updates are allowed.
No authoritative product transition matrix is invented: future workflows must
authorize each transition before using this internal boundary. Inactive/left retain
the same row, ID and creation time; mutation updates updatedAt. Duplicate creation
returns `already_exists`; missing/foreign/stale transitions return null. Other
service failures are sanitized without SQL or identifiers in diagnostics.

Migration `0004_tenant_membership_foundation` adds only this table, constraints,
indexes and tenant policy. ENABLE/FORCE RLS require church_id to equal transaction-local
app.current_church_id in both USING and WITH CHECK. The existing TenantDatabase
role/policy check now covers both church and church_membership on the same connection.
No new context mechanism or grants to ordinary/public users are introduced.

TenantContext describes trusted scope, not user entitlement; a user selector is not
authorization. There is no membership HTTP API, follower API, member directory,
onboarding, administration, role/permission or Primary Owner functionality. Task 1.7
remains blocked and no privileged capability or TOTP workaround is enabled.

## Task 1.11: reusable tenant isolation test harness

Task 1.11 maps to Phase 1E and changes test infrastructure only. The standard
fixture lives in `services/api/test/support/tenant/`. It applies the reviewed
migration journal to a generated disposable database, optionally checking an
upgrade from a named prior migration. Future journal entries are picked up by
the existing Drizzle migrator.

`fixturePool/fixtureDb` are privileged setup and inspection connections;
`runtimePool/runtimeDb` use an independently authenticated restricted LOGIN.
`withTenant` and `concurrentTenantDatabase` invoke the production
TenantContext/TenantDatabase transaction boundary. They do not grant entitlement.
Base fixtures provide opaque Tenant A/B and User A/B identifiers; membership
rows are opt-in fixture data, not product workflows.

Church and membership suites retain their module-specific queries and assertions
while sharing role validation, mismatch probes, pool cleanup and overlapping
transaction checks. No production module, schema, migration, authentication
behavior or CI configuration changed. Task 1.7 remains blocked.

## Task 1.12: internal roles and permissions foundation

Task 1.12 maps to Phase 1F. The unmounted AuthorizationModule provides an internal
repository and assignment-evaluation service, with no controllers, client API,
role seeds or administrative workflow. Role names are labels, never authorization
conditions. Member remains a relationship state; Primary Owner is a protected
ownership relationship, not an assignable role.

Application-owned church_role stores id, churchId, name, nullable description,
isSystem and timestamps. Custom role creation cannot set isSystem; generic rename,
delete and permission mutation paths protect system roles. Names are trimmed Unicode
labels (1–100 characters); PostgreSQL lower(name) is unique within each church.
Descriptions allow up to 500 characters. Lists use keyset pagination, default 50,
maximum 100. No global listing exists.

church_role_permission and church_membership_role use composite primary keys.
Their composite foreign keys include church_id on both sides, so even privileged
raw SQL cannot associate a role with another tenant's membership or permission row.
Role deletion cascades only its mappings; membership deletion removes its assignments;
church deletion cascades tenant authorization data, preserving global identities.

The application-owned registry currently accepts only members.view (permitted
directory read, inactive-eligible) and events.create (ordinary delegated content
creation, not inactive-eligible). These demonstrate assignment policy, not public
directory/event functionality. Unknown keys deny access even if inserted outside
the repository. Metadata defaults inactive eligibility to false and includes a
privileged-assurance classification; classified privileged keys always deny at this
foundation boundary. No privileged key is currently registered.

A single scoped joined query resolves current membership, assignments, existing
roles and permissions. Members may receive assigned permissions; inactive members
receive only explicitly inactive-eligible assignments; followers and left
relationships never receive role-derived permissions. Roles do not upgrade status.
Baseline relationship access and still-assigned object access are separate future
policies. No caching: each evaluation observes current committed assignment and
membership state.

All three tables have ENABLE/FORCE RLS with transaction-local app.current_church_id,
USING and WITH CHECK, plus explicit repository predicates and tenant-safe joins.
TenantDatabase now checks restricted credentials and enforced RLS on all five
tenant tables. Migration 0005_roles_permissions_foundation changes only the three
authorization tables. Its generated composite uniqueness statement is ordered
before referencing foreign keys, and FORCE RLS is explicitly appended as for
earlier tenant migrations.

TenantContext is trusted scope, not entitlement; the evaluator's membership ID
must come from authenticated server-side identity resolution, never an unchecked
client selector. The service returns only an assignment decision. Future operations
must combine it with object/privacy policy and required assurance, and re-evaluate
through the repository inside the protected operation's same transaction.
Administrative assignment APIs also require entitlement and auditing before release.
Task 1.7 remains blocked; no owner/admin capabilities, TOTP workaround, standard-role
activation, object-scoped permissions or Task 1.13 work are included.

## Task 1.7a — gated two-factor preparation

`AuthModule` still owns one Better Auth 1.7.4 instance. Its application-owned
`auth-two-factor.ts` boundary retains the official plugin's schema, credential
challenge hooks and limits, but mounts only these POST operations beneath
`/api/v1/auth/two-factor`:

- `enable`: authenticated current-password proof, issuer `Church Platform`, native
  six-digit/30-second TOTP setup URI and ten newly generated backup codes.
- `generate-backup-codes`: current-password proof and native enabled-state check;
  rotates unused codes without adding a session. Pending enrollment instead
  replaces its material through another `enable` request.
- `disable`: current-password proof and a database-authoritative session; removes
  factor material and clears native enabled state. Native behavior rotates the
  current session cookie/row. A session-create hook preserves its original
  `createdAt`, and the response explicitly includes `sessionRotated: true`.
- `verify-totp` and `verify-backup-code`: application handlers always return 503
  `SECOND_FACTOR_UNAVAILABLE`; they never invoke the native verifiers. The
  code-owned `SECURE_TOTP_VERIFICATION_ENABLED = false` cannot be changed by env.

No OTP send/verify, subsequent TOTP URI retrieval, backup-code viewing or server
TOTP generation API is mounted. Setup and rotation responses are `no-store`.
Native `enable` and code rotation require password and session, without a separate
freshness-age check. Native disable uses authoritative session middleware, which
also does not itself enforce `freshSessionMiddleware`'s age window. These password
proofs do not implement future privileged step-up.

Task 1.7a originally left enrollment pending. Task 1.7b-1 adds the authenticated,
generation-bound confirmation described below; production login completion remains
disabled. Before confirmation, `two_factor.verified = false` and
`user.twoFactorEnabled` is not enabled. A pending setup does not protect later logins:
ordinary password sessions remain ordinary sessions. For a native-enabled state,
password sign-in creates only a signed ten-minute two-factor challenge backed by
verification records; it deletes the interim session. The challenge cannot access
profile/member resources or complete authentication through either blocked path.
`twoFactorEnabled`, enrollment and backup-code possession are never assurance;
Task 1.12 privileged eligibility remains separately fail-closed and unchanged.

Migration `0006_two_factor_foundation` adds only the pinned generator's
`user.two_factor_enabled` boolean (default false) and global `two_factor` table:
`id` text PK; `secret`, `backup_codes`, `user_id` non-null text;
`verified` boolean default true; `failed_verification_count` integer default zero;
`locked_until` timestamp. Native enable explicitly writes `verified=false`.
Canonical indexes cover `secret` and `user_id`; the user FK cascades deletion.
These are Better Auth plugin-owned objects, without tenant columns or tenant RLS.
Application-owned email-change/profile tables stay separate. No automatic
migration or replay-consumption table is added.

Disable changes only the caller's factor state. The native session rotation
preserves the original application 30-day absolute limit; other sessions are not
silently added or upgraded. Password change/reset and email change leave factor
material intact, and a native-enabled account still challenges on its next login.
A reset revokes sessions as before; email change neither restores codes nor grants
assurance. Trusted-device cookies are rejected on credential sign-in, and the
preparation operations reject client fields such as `trustDevice`, `issuer`,
`method` and `userId`. No client can choose OTP mode or a trusted-device bypass.

## Task 1.13 standard-role identity and provisioning foundation

Phase 1G now has four canonical system-role identities in
`services/api/src/authorization/standard-roles.ts`: Group Leader, Area Leader,
Event Administrator and Children’s Worker. Every definition is frozen,
`isSystem=true`, `privileged=false`, with an intentionally empty permission bundle.
Assigned group, area, event and child operational capabilities cannot yet be
represented safely by tenant-wide grants. Neither `members.view` nor the separately
delegable `events.create` capability is inferred from these roles. The Task 1.12
permission registry and membership-state policy are unchanged. These roles are
prepared identities, not fully operational feature access.

`StandardRoleService.ensureStandardRoles(context)` is an explicit internal
operation, exported by the still-unmounted AuthorizationModule. It requires a
trusted TenantContext and uses the existing TenantDatabase transaction and scoped
AuthorizationRepository. There is no HTTP endpoint, startup seed, migration seed
or automatic membership-role assignment. Future invocation needs a reviewed
provisioning/authorization boundary; possession of TenantContext is scope, not
permission to administer roles.

The existing text role primary key stores stable identity as
`system-role:<canonical church UUID>:<fixed role key>`. This unambiguous namespace
and its four keys are persistent compatibility identifiers; display-name changes
do not change identity. Custom-role creation still generates its own random ID and
cannot select this namespace or set isSystem. No key column or migration is needed.

Provisioning locks the scoped church row for the transaction, serializing same-
church runs across connections/processes, then creates missing identities and
reconciles canonical names/descriptions and exact empty bundles. Extra mappings
are deleted only for these four canonical system rows; custom roles, their grants
and assignments are preserved. Repeated unchanged provisioning preserves IDs and
timestamps. A reserved ID occupied by a custom row, or a case-insensitive display-
name collision, fails the whole transaction with a sanitized
`STANDARD_ROLE_CONFLICT`; no existing custom/differently identified row is adopted.
The operation does not grant authority from role labels and does not cache results.

Future bundle activation requires explicit reviewed changes after group/area/event
object authorization or child operational scope, safeguarding and auditing exist.
Main Church Administrator remains blocked on Task 1.7b and privileged assurance;
Primary Owner remains a protected ownership relationship; Platform Superadmin
remains platform-scoped. None is provisioned here.

## Task 1.14: Church Verification State Foundation

Task 1.14 maps to Phase 1J and reuses `church.verificationState` unchanged. It is
church trust metadata, never user authorization or MFA assurance:

| State | Meaning |
| --- | --- |
| `unverified` | Default; no submitted/active verification request, no verified status. |
| `pending` | Requested and awaiting review; not verified. |
| `verified` | Review succeeded; future presentation may display verified status. |
| `rejected` | Submitted request was rejected; not verified. |
| `revoked` | Previously verified status was explicitly withdrawn; not verified. |

The centralized `church-verification-policy.ts` permits exactly:

| From | To | Action class |
| --- | --- | --- |
| `unverified` | `pending` | Church-side request |
| `rejected` | `pending` | Church-side request |
| `revoked` | `pending` | Church-side request |
| `pending` | `verified` | Platform review |
| `pending` | `rejected` | Platform review |
| `verified` | `revoked` | Platform review |

All other different-state pairs return `invalid_transition`; unknown states throw
a sanitized validation error. Every same-state pair returns `unchanged`. The
policy's request/review classification is descriptive, not a caller capability.

`ChurchVerificationService.requestVerification(context)` is exported only through
the internal, unmounted ChurchModule. It uses trusted TenantContext and the existing
TenantDatabase transaction. The repository accepts no destination state or caller-
supplied church ID: it locks the explicitly scoped church row, evaluates the policy
for `pending`, and conditionally updates that row's verificationState/updatedAt.
A real transition returns `changed`; pending returns `unchanged` without a timestamp
write; verified returns `invalid_transition`. Missing/invisible church returns
`not_found`; a lost conditional update returns `stale`. Database failures are
sanitized without driver causes. No generic state setter is exported.

Concurrent duplicate requests serialize so only one changes the row. Existing
details updates continue rejecting verificationState/status/ownership input.
Church status is independent: an inactive church can remain verified. Verification
changes no membership, role, grant, session, assurance or ownership state.

Platform review is pure domain policy only in production. Its persistence, actor
authorization, reviewer metadata/evidence and mandatory audit workflow await the
platform administration architecture. A test-only scoped compare-and-set primitive
proves one winner for competing verified/rejected decisions without shipping a
cross-tenant mutation path. There is no superuser/BYPASSRLS runtime, platform admin
flag, HTTP endpoint, review queue, onboarding, ownership or badge UI. Future request
callers must authorize the specific action before constructing scope; future review
must add platform authority, concurrency and audit controls before activation.

No schema, migration, permission key or standard-role change is required. Task 1.7b
remains blocked; Phase 1H ownership, Phase 1I owner-creating onboarding and Phase 1K
privileged administration remain deferred while this metadata foundation proceeds.

## Task 1.15 — Assurance, Elevation & Step-Up Foundation

Historical baseline: login/issuance gate statements here are superseded by Task 1.7b-2 below.

Task 1.15 maps to Phase 1L. Ordinary authentication, elevation and recent step-up
are independent concepts. `AssuranceModule` provides only an internal service:
no completion/status controller, proof issuer or privileged feature is exposed.
`SECURE_ELEVATION_COMPLETION_ENABLED=false` is code-owned, with no environment
override. Only a separately reviewed replay-safe Task 1.7b proof implementation
may introduce issuance. Task 1.7a preparation remains gated; enrollment, a user
flag, recovery codes, trusted devices and social login do not confer assurance.

Application-owned `session_assurance` has one row per concrete session ID: the
primary key references Better Auth `session.id` with ON DELETE CASCADE. There is
no redundant user ID: ownership is joined from the session, eliminating mismatched
user/session pairs without changing Better Auth schema. This global account state
has no church ID or tenant RLS. Nullable `elevatedAt`, `lastElevatedActivityAt` and
`stepUpAt` use timestamptz; `createdAt`/`updatedAt` are record timestamps, not proof.
No secrets or history are stored. Migration `0007_session_assurance_foundation`
adds only this table and FK; the pinned Better Auth generator is unchanged.

`AssurancePolicy` uses an injectable server clock and the Task 1.4 normal-session
policy. Elevation requires BOTH `lastElevatedActivityAt + 15 minutes > now` and
`elevatedAt + 8 hours > now`. Step-up independently requires
`stepUpAt + 5 minutes > now`; equality is expired. Invalid/future proof timestamps,
proof before session creation, and activity before elevation fail closed.
A missing, revoked, rolling-expired or 30-day absolute-expired session denies all
assurance. Original session creation and ordinary expiry are never updated here.

Only an explicitly successful protected privileged operation may call
`recordSuccessfulPrivilegedActivity`; there are no current callers. Session/profile
reads, polling and heartbeats never refresh it. The method rechecks the underlying
owned session and existing assurance under transaction locks, samples time after
locking, and updates only activity/record-update time. It never inserts or upserts,
never moves elevation start or step-up, and cannot resurrect invalidated rows.
Concurrent invalidation deletes the row regardless of refresh ordering. Expired
rows can remain for later cleanup but cannot authenticate or refresh.

`SessionAuthorizationService` combines current tenant membership/role permissions
with authoritative session/assurance evaluation. Server code obtains the user and
non-secret session ID through `AuthSessionReader`, never a client identity selector.
The same restricted tenant transaction performs the checks; object/privacy rules
and transaction-bound rechecks remain required when future protected mutations
are introduced. Permission metadata is immutable and owns both privileged-assurance
and recent-step-up requirements. No privileged key is registered and the fixed
gate additionally denies protected keys. Stored assurance alone grants nothing.

Factor disable uses the supported Better Auth user-update before hook, after native
password verification and before disabling/removing the factor. All own assurance
is deleted first; failure aborts the native transition with a sanitized error.
A later native failure may conservatively leave the user without assurance. Native
session rotation keeps the original absolute start and never copies assurance to
the replacement. Logout/revocation/password reset cascade deletions; password and
email changes preserve retained proof timestamps without issuing fresh proof.
Recovery-code regeneration also cannot issue proof. Future factor-reset flows must
invoke the same invalidation boundary before mutation. Production factor issuance,
privileged operations, security-event history and audit integration remain deferred.

## Task 1.7b-1 — transactionally consistent enrollment

Historical baseline: login/issuance gate statements here are superseded by Task 1.7b-2 below.

Only enrollment confirmation is activated. POST `/api/v1/auth/two-factor/enable`
requires the existing authenticated session, current password and trusted origin.
It returns native setup material plus a server-generated, non-secret `enrollmentId`.
POST `/api/v1/auth/two-factor/enrollment/confirm` accepts exactly `enrollmentId`
and a six-digit `code`, with an authenticated session and trusted origin. Native
Better Auth generates, encrypts and verifies the factor material; no library patch,
custom TOTP verifier or replay-consumption store is introduced.

Application-owned `two_factor_enrollment` stores `user_id` (PK, cascading user FK),
unique UUID `id`, SHA-256 `factor_fingerprint` of the native encrypted secret,
`created_at` and `expires_at`. It contains no plaintext secret, code or setup URI.
Row presence means pending; completion/disable deletes it, replacement overwrites
it with a new generation. No enrollment history is retained. A generation expires
one hour after creation; `expiresAt <= now` is stale. This is separate from the
unchanged Better Auth-owned schema. Migration: `0008_two_factor_enrollment_binding`.

Begin, confirm and disable serialize on the same PostgreSQL user-row lock, across
application instances. The existing DatabaseService transaction owns the connection.
`AuthTransaction` routes the unmodified public Better Auth Drizzle adapter through
that connection using request-local async scope; normal auth requests still use the
pool. Session validity is rechecked after the lock. Native material writes and
application generation changes commit or roll back together. Lock waits are bounded
to five seconds. Response cookies are forwarded only after successful commit.

Pending may replace pending. If confirmation wins, the verified factor cannot be
replaced: later enable returns a safe conflict without changing material. If
replacement wins, the old generation cannot confirm; the replacement requires its
own material. Confirmation checks ownership, ID, ciphertext fingerprint and expiry
before invoking the native verifier. Duplicate confirmation has one successful
transition. Verified-factor change/reset is a separate, unimplemented workflow.

Native confirmation rotates the existing authenticated session; it does not add
an extra session. The transaction preserves its original `createdAt`, maintaining
the 30-day absolute limit. The safe confirmation response includes `sessionRotated:
true`; the new cookie replaces the previous one. Other sessions are not changed by
this enrollment subtask. Enrollment creates no assurance or privileged access.
Disable also serializes factor removal, pending-state deletion and existing
assurance invalidation in the same transaction.

Both production login completion routes (`verify-totp`, `verify-backup-code`)
remain 503-gated. No trusted-device path, elevation issuer, role activation or
Task 1.16 work is enabled. A newly verified factor therefore causes subsequent
password login to enter a challenge that cannot yet complete; production login
activation requires the separate Task 1.7b review.

## Task 1.7b-2 — native factor login and explicit assurance proof

This section supersedes the historical closed-login/issuance gates in Tasks 1.7a,
1.15 and 1.7b-1. Task 1.7b-1 enrollment generation binding, pending-only replacement,
user-row serialization, transactional native writes and original session age are
unchanged. Verified-factor replacement remains unavailable.

POST `/api/v1/auth/two-factor/verify-totp` and `/verify-backup-code` now invoke the
native Better Auth 1.7.4 verification endpoints. Both require the configured API
origin, an exact code-only body and an unexpired signed sign-in challenge belonging
to an enabled, verified factor. The native ten-minute challenge is consumed before
session issuance. Password-only authentication has no normal application session.
Active-session calls to these public endpoints are rejected, so they cannot bypass
the generation-bound enrollment confirmation route. Trusted-device input/cookies
remain rejected; email/SMS OTP and subsequent secret retrieval remain unavailable.

Ordinary factor login creates an opaque PostgreSQL session and no assurance.
Four server-only Better Auth API operations provide explicit proof completion:
`completeTotpElevation`, `completeRecoveryElevation`, `completeTotpStepUp` and
`completeRecoveryStepUp`. They have no HTTP route. The application selects the
purpose through the operation, never a client-supplied flag or timestamp. A valid
current session and verified enabled factor are required. The operation locks the
user and owned session, rechecks normal-session validity, invokes the native factor
verifier, then writes only server-generated assurance times in the same application
transaction. Recovery-code consumption rolls back if assurance persistence fails.
No generic claim-to-assurance issuer is exposed.

Elevation writes elevation start/activity; step-up writes only its independent
proof time. Neither proof creates or rotates a session or changes its `createdAt`.
The 15-minute inactivity/eight-hour absolute elevation and separate five-minute
step-up windows remain unchanged, as do 7-day rolling/one-day refresh/30-day absolute
normal sessions. Polling never issues or refreshes proof. Session revocation/logout
and password reset cascade assurance deletion. Factor disable invalidates assurance;
email change preserves enrolled material and retained proof times without new proof.
Tenant, membership, permission and required-assurance checks still all apply.
No privileged permission, role, ownership or administrative flow is activated.

SECURITY ACCEPTANCE — TOTP REPLAY: Better Auth 1.7.4 can accept a successfully used
TOTP again within its native acceptance window, including independent login
challenges and active-session proof operations. This is the explicitly temporary
accepted limitation tracked by `better-auth/better-auth#10387`, not a fix or RFC
6238 §5.2 one-time-use compliance. Native algorithm/window parameters are unchanged.
There is no custom replay guard, library patch, dependency change or new migration.
Better Auth-owned schema remains identical; application-owned tables remain separate.

## Task 1.16 — Primary Owner Foundation (Phase 1H)

Primary Owner is an application-owned protected relationship, never a church role
or permission bundle. `church_primary_owner` has `church_id` as its primary key,
`membership_id`, and timestamptz `created_at`/`updated_at`. The composite membership
FK `(church_id, membership_id)` prevents cross-tenant references independently of
RLS. Church and membership deletion cascade ownership. Provisioning may have zero
owners; the database allows at most one. Future completed onboarding must establish
one eligible owner, rather than backfilling synthetic owners into existing churches.

The unmounted `OwnershipModule` exports only `OwnershipService`. Its server-only
operations are `isPrimaryOwner`, `establishInitialOwner` and `transferPrimaryOwner`.
Every call needs an already authorized TenantContext and a server-resolved
SessionSubject (`userId`, non-secret `sessionId`) obtained through AuthSessionReader.
These parameters are not public DTOs or client-selected identities. The service
revalidates the concrete session against PostgreSQL. No cookie/session token enters
ownership persistence or responses. Future onboarding must authorize church creation
and construct its provisioning scope; it cannot pass an arbitrary client tenant.

Initial establishment is deliberately self-establishment: the authenticated actor
must be the target member. There is no fake admin/system actor, no actorless overload,
no automatic membership or role assignment, and no automatic elevation. Both initial
and transfer recipients require current `member` status plus one verified native
factor and the enabled user flag. Pending material, a flag alone or role names do
not qualify. Transfer additionally requires the current owner's valid session,
current eligible membership/factor, elevation and recent step-up. Shared Task 1.15
policy enforces 15-minute inactivity, eight-hour absolute elevation and the separate
five-minute proof window; equality is expired. Another session cannot borrow proof.

Mutation transactions acquire sorted user locks, a scoped church lock, and current
membership/session/assurance/factor locks. This serializes establishment and transfer,
protects recipient eligibility against concurrent state/factor changes, and rechecks
assurance time after waits. Lock waits are bounded to five seconds. Transfer uses
one conditional owner-row update plus its audit insert, never delete/recreate.
A competing or stale former owner receives `conflict`; self-transfer is `unchanged`
without timestamp or audit changes. Invalid eligibility/proof returns `denied`;
missing and foreign targets share `not_found`. Database failures are sanitized.

`church_ownership_audit` is limited to `initial_owner_established` and
`ownership_transferred`. It stores UUID-text `id`, `church_id`, event type, previous
nullable/new membership ID snapshots, actor user/session ID snapshots and one
server/database timestamp. Initial establishment has no previous owner; transfers
must have distinct previous/new IDs. No password, token, factor material, IP/device
fingerprint or profile data is stored. Ownership mutation and audit insertion are
atomic: audit failure rolls back the owner change. Failed/stale/self transfers add
no success event. This is not a general audit framework.

Audit membership/user/session IDs intentionally have no destructive lifecycle FKs:
they are historical snapshots validated by the service at event time. Ordinary
membership, user or session deletion must retain the evidence. The only cascading
audit FK is church ID, for a future authorized complete-tenant deletion. Both new
tables have ENABLE/FORCE RLS and explicit church predicates. Audit RLS additionally
rejects UPDATE/DELETE, even with table CRUD grants. Operational runtime grants should
be SELECT/INSERT only on audit, no TRUNCATE/DDL/owner privileges. Ownership checks
need only non-secret auth columns; row locking additionally requires PostgreSQL
UPDATE privilege (the restricted test role receives ID-column-only lock privilege).
No runtime RLS bypass is introduced.

Owner authority is uncached. Inactive/follower/left membership or unavailable verified
factor immediately denies it while retaining the relationship. Restoring `member`
and verified/enabled 2FA reactivates the predicate, but protected transfer still
requires fresh valid assurance. Ownership grants no ordinary feature permission,
platform authority or cross-tenant access. Existing permission/RLS checks remain.
The operation creates no sessions, changes no session age and issues no assurance.

Migration `0009_primary_owner_foundation` adds only these two application-owned
tables, their constraints/index and policies; FORCE RLS follows the existing explicit
migration convention. Better Auth-owned schema and dependencies are unchanged.
There is no owner/transfer HTTP API, onboarding, owner-removal operation, Main Church
Administrator, Platform Superadmin, UI or recovery flow. Exposing these operations
later requires reviewed caller authorization and UX; mandatory audit already exists
for internal writes. The separate accepted #10387 exception remains unchanged.

## Task 1.17 — Church Onboarding Foundation (Phase 1I)

`OnboardingModule` exports the server-internal
`ChurchOnboardingService.createChurch(subject, input)`. Task 1.17 introduced no HTTP
route; Task 1.18 adds the transport below. No startup provisioning, shared client
contract or onboarding UI exists.
The subject must come from AuthSessionReader; it is not a public identity DTO.
The service revalidates the exact session against PostgreSQL and locks current
identity/session/factor state. Initial onboarding requires a valid authenticated
session and verified/enabled 2FA. By explicit Phase 1I decision it requires neither
elevated assurance nor recent step-up. This does not relax Task 1.16 transfer:
transfer still needs current ownership, valid session-bound elevation and step-up
strictly under five minutes, and eligible actor/recipient membership and 2FA.

One DatabaseService transaction/connection performs all stages:

1. Validate existing creator session and verified/enabled factor using the ownership
   eligibility boundary. No session, factor or assurance is created.
2. Allocate a fresh UUID server-side. Construct trusted provisioning TenantContext
   only for that newly allocated ID, after creator authorization.
3. Apply restricted-role/ENABLE/FORCE RLS checks and transaction-local
   `app.current_church_id`, then insert the church with active/unverified defaults.
4. Use MembershipRepository to create the creator's `member` relationship.
5. Use the transaction-aware initial OwnershipService operation to establish that
   membership as owner and insert its mandatory `initial_owner_established` audit.
6. Use transaction-aware StandardRoleService to provision its four canonical roles.
7. Commit only if every stage succeeds; any exception or denied ownership outcome
   escapes the outer transaction and rolls back all artifacts.

RLS bootstrap allocates the ID before the row exists: the existing church INSERT
policy itself requires that ID as transaction-local context. It cannot insert the
row first with no scope. This is an application-authorized new-tenant scope, not an
existing-tenant selector. INSERT never upserts an existing church. No SUPERUSER,
BYPASSRLS, table-owner credential, security-definer routine, schema change or RLS
exception is used. TenantDatabase.inTransaction retains the same checks as its
standalone transaction method. Ownership/role variants reuse the caller's handle
without opening/committing a nested transaction. Context is cleared by transaction
completion, including failure and connection reuse.

ChurchRepository reuses parseChurchDetails and explicit field mapping. Client IDs,
creator/owner selectors, lifecycle states, roles and permissions are rejected.
Slug canonicalization and PostgreSQL uniqueness remain authoritative: duplicates
return a sanitized slug conflict, not existing tenant details. Concurrent identical
slugs have one complete winner; different slugs may create multiple churches for
one eligible user. No cross-request idempotency system or one-church/user rule exists.

Each success has one church, member, owner and initial audit, four system roles
(`group_leader`, `area_leader`, `event_administrator`, `childrens_worker`), zero
role assignments and zero permission rows. Role definitions remain nonprivileged
with empty bundles. No verification request, Main Church Administrator, wildcard
owner permission, transfer, or generic church administration is performed. The
internal result explicitly maps necessary church/membership/owner identifiers only;
it exposes no session, factor or audit internals. Task 1.18 adds the separately reviewed HTTP caller policy, Origin/CSRF,
creation limits and transport DTOs below.
The existing temporary better-auth/better-auth#10387 exception remains unchanged.

## Task 1.18 — Public Church Onboarding API

OnboardingHttpModule mounts only `POST /api/v1/churches` and imports the internal
Task 1.17 module without changing its orchestration. AuthSessionReader supplies the
cookie-authenticated user/session, forwarding cookie updates. The guard requires
the exact configured Better Auth origin, rejects query parameters, and limits
attempts by server-resolved user ID. Three attempts per sliding hour are allowed,
including invalid input and failed operations after the Origin check. The bounded
process-local limiter runs in all environments; capacity exhaustion denies new
identities rather than evicting live limits. It is not distributed or restart-durable.

The local request pipe delegates to parseChurchDetails: required `name` and `slug`;
optional nullable `addressLine1`, `addressLine2`, `postalCode`, `locality`, `region`,
`countryCode`, `denomination`, `logo`. This reuses the existing flat address shape,
Unicode limits, lowercase slug normalization, uppercase country syntax and HTTPS
logo policy. Unknown/protected fields, including creator/owner, lifecycle, membership,
role, permission and factor selectors, fail validation. Request validation and the
explicit response DTO remain local to Nest; no shared contracts change is needed.

The unchanged service rechecks the valid session and verified/enabled factor inside
its atomic transaction. Initial onboarding requires no elevation or step-up;
ownership transfer retains its stricter requirements. Success returns 201 only after
commit, with `church: {id,name,slug,status,verificationState}`, `membership: {id,status}`
and `ownership: {isPrimaryOwner:true}`. Defaults remain active/unverified/member.
The mapper excludes audit, role, credential, session and factor internals. Guarded
responses carry `Cache-Control: no-store`.

Stable sanitized Nest errors: 400 invalid body/query; 401 absent/revoked/expired
session; 403 untrusted Origin or ineligible creator; 409 unavailable slug; 429 limit;
503 unavailable session/storage/service. Session invalidation after the guard is
rejected again inside the transaction; that late eligibility failure returns 403.
All church/member/owner/audit/four-standard-role writes retain the same restricted
PostgreSQL transaction. No assignments, wildcard permissions, verification submission,
general administration, member/role management, transfer route, Main Church
Administrator, Platform Superadmin or UI is added. No schema/migration or Better
Auth change; the documented better-auth/better-auth#10387 exception is unchanged.

## Task 1.19 — Main Church Administrator Foundation

Task 1.19 maps to the Phase 1G / Phase 1K bridge. It extends explicit canonical
provisioning (including Task 1.17/1.18 onboarding) to five system roles. The original
four definitions remain nonprivileged with empty bundles. The fifth stable key is
`main_church_administrator`, named Main Church Administrator, with `isSystem=true`
and code-owned `privileged=true`. Its exact bundle is `members.manage` and
`church.settings.manage`. No migration or persisted privileged flag is needed.

Both permissions have `inactiveEligible=false`, `requiresPrivilegedAssurance=true`
(the existing metadata name for requiring elevation), and `requiresRecentStepUp=false`.
Member administration excludes separately protected sensitive personal data;
settings administration excludes deletion and security-sensitive settings. Role
administration (`roles.manage`), critical settings, ownership operations and platform
administration are outside this bundle and require separate reviewed capabilities.

Provisioning retains the scoped church-row lock and existing stable role IDs.
It restores missing canonical keys and removes stray mappings, including unknown
keys, only from the target tenant's canonical system roles. Existing canonical
mapping timestamps, custom roles, assignments and other tenants remain unchanged.
Concurrent/repeated provisioning is serialized and idempotent; custom collisions
abort the entire transaction. Existing churches require explicit reconciliation;
there is no startup/migration seed. Onboarding creates five roles, two permission
mappings and **zero membership-role assignments** in its existing atomic transaction.
The creator/Primary Owner does not automatically receive the administrator role.
This supersedes earlier task descriptions of four-role provisioning.

`SessionAuthorizationService` is the internal authoritative combined evaluator.
For either privileged key it checks tenant-scoped current membership/assignments,
the exact user-owned session and its elevation, and current database factor state:
enabled 2FA with exactly one verified factor. Inactive/follower/left relationships
cannot exercise these permissions. Factor loss, membership/assignment/grant changes
and session revocation affect the next uncached evaluation. Custom roles granting
the same keys inherit identical requirements regardless of label. The sessionless
compatibility service/repository refuses privileged keys; the separate repository
eligibility primitive is not an authorization result.

Elevation stays session-bound with 15-minute inactivity and eight-hour absolute
limits. These ordinary permissions need no recent critical step-up; separately
classified critical operations still require the five-minute window. Evaluation
never issues or refreshes assurance. Future protected writes must recheck entitlement
inside their operation transaction and enforce object/privacy rules and audit needs.
No administrative HTTP route, member/settings mutation, role assignment API, frontend
or assurance issuer is introduced. Primary Owner remains its separate protected
relationship and predicate; an administrator role cannot replace ownership checks.
Better Auth 1.7.4 / Nest integration 2.8.0 and the temporary #10387 exception are unchanged.

## Task 1.20 — Base Church Administration API (Phase 1K)

The approved Phase 1K HTTP scope is exactly PATCH
`/api/v1/churches/:churchId/settings` (`church.settings.manage`) and GET
`/api/v1/churches/:churchId/members` (`members.manage`). Member administration is
read-only listing; membership status transitions, creation/deletion, role assignment,
ownership operations and security-sensitive settings remain deferred. No client UI
is introduced. Primary Owner alone grants neither permission and cannot be altered
through either operation.

Both routes resolve the database-authoritative session through AuthSessionReader.
The server uses the route UUID only as a candidate lookup scope, under transaction-local
RLS and explicit predicates. The centralized SessionAuthorizationService checks
current member eligibility, scoped role permissions, enabled/verified 2FA and the
exact session's elevation before disclosing data or taking resource locks. It
rechecks after locking authorization-sensitive rows in the operation transaction.
Unknown/foreign churches return the same denial. Custom roles have identical gates.
Neither capability requires the separate five-minute critical step-up.

PATCH accepts only name, slug, addressLine1, addressLine2, postalCode, locality,
region, countryCode, denomination and logo. It reuses canonical Church validation,
including lowercase slug uniqueness. Omitted fields survive; explicit null clears
nullable fields. Updates serialize on the scoped church row, preserving independent
concurrent patches. Empty/unknown/protected input fails. The response explicitly maps
id, those ten ordinary fields, status and verificationState; the latter two are
read-only. A normalized no-op changes no timestamp, audit or assurance.

GET returns `{items: [{id, userId, status}], nextCursor}` only. It uses the existing
membership-ID cursor, default limit 50, maximum 100. A full page returns its last ID
as nextCursor (the following page may be empty); shorter pages return null. All four
relationship states may appear for administration. No private profile, factor,
session, assurance, ownership flag or audit data is joined or returned. GET does not
refresh elevation and exposes no membership mutation.

The application-owned `church_admin_audit` is separate from ownership audit. Migration
`0010_church_admin_audit_foundation` adds only this table, its church FK, event/field
checks, tenant/time index and ENABLE/FORCE RLS with restrictive no-update/no-delete
policies. Fields are id, churchId, eventType, actorUserId, actorSessionId, changedFields
and createdAt. The sole event is `church_settings_updated`. Metadata contains only
sorted distinct changed field names, never old/new values. Actor identifiers are
historical snapshots without cascading user/membership/session FKs. Church deletion
may cascade its own history in a future separately authorized workflow.

Settings update, mandatory audit insertion and existing Task 1.15 successful activity
recording use ONE PostgreSQL transaction/connection. Any error or expiry before
activity recording rolls all three back. No refresh happens on reads, no-ops,
validation, denial, conflict, rate limit or storage failure. Elevation remains
15 minutes inactivity / eight hours absolute; its initial proof and step-up timestamps
are not moved. Session creation/age and 30-day absolute policy remain unchanged.
Lock waits are bounded to five seconds. Runtime needs the existing restricted tenant
DML/row-lock grants plus SELECT/INSERT on admin audit; it must not own/bypass RLS.
The audit repository additionally verifies its table's enforced RLS/ownership state.

PATCH requires exact configured Origin and uses a bounded per-process sliding limit
of 20 attempts per authenticated user per minute (10,000 live identities; capacity
fails closed). GET follows existing safe-read policy with no new Origin requirement
or limiter. All routed responses use Cache-Control: no-store. Errors map to 400
invalid input, 401 no valid session, 403 entitlement/Origin denial, 409 slug conflict,
429 rate limit and sanitized 503 storage failure. No foreign existence-specific 404
is returned by these collection/settings operations. There is no audit HTTP endpoint.
Better Auth 1.7.4, Nest integration 2.8.0 and the temporary #10387 exception are unchanged.

## Task 1.21a — Google Pre-Authentication Bridge

Google authentication remains production-disabled. Better Auth 1.7.4's native Google callback does not run its password-login two-factor hook and can issue a usable session to a TOTP-enabled user. This is not an accepted exception. The server-only bridge retains native Google authorization-code, PKCE, signed state-cookie and provider-identity validation, while replacing the public social initiation/callback endpoint registrations with server-only operations. Public native social, linking/unlinking and provider-token routes are disabled; no environment switch activates them. Optional `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be supplied together. There are no new dependencies.

This foundation authenticates already-linked Google identities only. Native signup is disabled, implicit email linking is disabled, and provider profile refresh cannot overwrite the canonical application email. A linked social-only user needs no local password. New Google account provisioning and explicit linking remain separate reviewed work.

A hash-keyed callback reservation in the existing verification table allows only one attempt per OAuth state across instances. Native state validation still applies. Failed attempts require new OAuth initiation. Provider network operations run outside database transactions. A short transaction then locks the canonical user and checks current factor state. The original native callback session insertion is always cancelled through the supported before-create hook. For a consistent no-factor account, the bridge creates an ordinary native session under that lock and releases its cookie. For an enabled, verified factor, it inserts only pre-authentication state: no session INSERT occurs, even transiently. Inconsistent factor state fails closed. No assurance is issued.

Application-owned `social-pre-auth:` verification records contain immutable user ID, canonical Google account row ID, hashes binding its provider subject and enrolled factor, and a server-generated event ID. A 256-bit random cookie credential is stored only as SHA-256 in the record key. The workflow expires ten minutes after creation; equality is expired. Every resolution rechecks live user/account/factor bindings. Deletion, unlinking, factor replacement or disable invalidates the challenge. User deletion can leave an inert verification record until cleanup; it cannot authenticate. Callback reservations use a separate `google-callback-event:` namespace and contain only a state hash, marker and timestamps. Neither namespace stores provider tokens or session tokens. No schema or migration is needed.

The internal consumption primitive locks and removes a challenge exactly once, but grants no session or assurance. Task 1.21b must bind actual native TOTP/recovery proof, consumption and resulting session creation in one reviewed transaction. There is no public completion endpoint in 1.21a. The pre-auth cookie is not a Better Auth session, so AuthSessionReader and all protected APIs reject it. Existing browser session/trusted-device cookies are rejected at bridge entry; assurance from another session is never inherited. Internal entry points require the exact configured Origin and fixed application destinations. Public browser callback adaptation, throttling and required authentication security events remain activation prerequisites.


## Task 1.21b-0 — Authentication Security Event Foundation

`auth_security_event` is application-owned global identity infrastructure, separate
from operational Nest Logger messages, tenant `church_ownership_audit`, and tenant
`church_admin_audit`. It is not a general audit platform. It has no tenant ID, tenant
RLS, public read endpoint or mutation API. The internal `AuthSecurityEventService`
accepts a caller-owned PostgreSQL transaction and strictly validated event input;
it cannot authenticate, create a session, issue assurance or grant permissions.

The closed registry is `password_changed`, `password_reset`, `email_changed`,
`two_factor_enabled`, `two_factor_disabled`, `recovery_codes_regenerated`,
`recovery_code_used`, `session_revoked`, and `authentication_failure`. These cover
implemented ADR 0003 authentication operations and the explicitly approved failure
persistence foundation. Provider linking/unlinking and factor reset are not enabled;
no speculative keys for them are added. Privileged grants/revocations and ownership
remain separate domain responsibilities, not duplicate authentication events.

The table stores a server-generated ID, event type, historical actor/subject/session
IDs, derived success/failure outcome, tightly constrained JSON metadata, and a
PostgreSQL timestamp. Success identifies the account proving the operation as both
actor and subject; password reset may have no session. Unattributed failures may
have null identifiers. `session_revoked.session_id` identifies the revoked session;
other events reference the initiating/proving session when one exists. Recovery
metadata is only `purpose` (`authentication`, `elevation`, `step_up`); failure
metadata is only `method` (`password`, `totp`, `recovery`) and `category` (`repeated`,
`suspicious`). All other metadata is empty. Unknown keys fail closed in the writer
and database. A subject/time/ID index supports chronological subject history.

No foreign keys erase historical identifiers when users, sessions, memberships or
churches are deleted. No automatic retention purge is introduced; retention/access
and later erasure policy require separate review. Runtime must receive INSERT only
on this table, without SELECT/UPDATE/DELETE/TRUNCATE/DDL or table-owner authority;
disposable restricted-runtime tests prove these grants. The migration does not
assume a production role name or grant access to PUBLIC. No church context is needed.

Enrollment confirmation, disable, regeneration, password changes/resets, explicit
current/specific/other/all session revocation, and completed email changes audit in
the same transaction as their business writes. A revoked-session event is written
for each actually removed session in explicit revocation and password/email flows;
no-op requests write none. Native factor session rotation is represented by its
factor lifecycle event. The mandatory event failing aborts all enclosing writes.
Existing operational notification/logging remains separate and is not evidence of
durable commit.

Recovery-code use is integrated into the existing transactional elevation/step-up
proof boundary. Native consumption, event insertion and the explicitly requested
assurance mutation share one AuthTransaction connection; no new session is created.
Per Task 1.21b-0 section 15, ordinary native recovery-login wrapping is deferred;
its existing single-use behavior remains unchanged. The reusable writer and native
recovery-proof rollback/concurrency tests establish the boundary Task 1.21b can use
later with its own atomic challenge and session issuance. Do not claim ordinary
recovery-login success is already durably audited.

ADR 0003 does not define a repeated/suspicious incident threshold. Per the approved
foundation-only allowance, automatic classification/emission is deferred, without
changing native attempt counters, lockout or rate limiting. `recordFailure` is a
separate narrow transaction invoked only after a classified failure is conclusively
determined and its authentication transaction has ended. Its failure never grants
access. No background retry or general event processor is introduced. Failure-policy
review/emission remains required before claiming complete Phase 1 audit coverage.

Migration `0011_auth_security_event_foundation` adds only this table, constraints
and index. Better Auth-owned schema and versions remain unchanged. Task 1.21b is
not resumed: Google initiation/callback remain production-disabled; the native
Google second-factor bypass is unaccepted. The separate temporary accepted
`better-auth/better-auth#10387` cross-challenge TOTP replay limitation is unchanged.

## Task 1.21b — Google 2FA Completion & Session Issuance

Maps to Phase 1A social authentication and Phase 1L second-factor non-bypass.
Task 1.21a and Task 1.21b-0 are complete prerequisites. This section supersedes
older statements that Google factor completion has not been implemented.
Production Google initiation/callback authentication remains fixed disabled.

The only new HTTP operations are POST `/api/v1/auth/social/google/verify-totp`
and POST `/api/v1/auth/social/google/verify-recovery-code`. Browser callers send
`{ code }` with the existing HttpOnly `social_pre_auth` cookie. Controlled callers
may instead present `{ challenge, code }`; contradictory cookie/body credentials
are rejected. No other fields, query-based identity, existing authenticated session
or trusted-device context is accepted. Success returns only `{ status: true }`
and the existing secure opaque session cookie, clearing the pre-auth cookie.
Exact configured Origin is required; responses are no-store. Public Google
initiation/callback, new signup, provider linking/unlinking and token APIs stay closed.

GoogleCompletion uses the existing AuthTransaction adapter routing. A hash lookup
only identifies a lock target. The transaction locks the user first (the same order
as enrollment/disable), locks and revalidates the Google challenge, then locks its
provider/factor rows and rechecks current bindings. The Task 1.21a ten-minute expiry
is checked after waiting and again after successful proof; equality is expired.
Deleted, disabled, unverified, replaced or mismatched bindings cannot authenticate.

The coordinator uses supported native TOTP/recovery sign-in endpoints, never a
custom verifier or synthetic authenticated session. An internal signed native
challenge and its attempt record reuse verification persistence under a separate
`social-factor:` namespace derived from the credential hash. They share the original
expiry and are never delivered to the client. Native proof, recovery-code compare-and-
swap consumption and native session insertion run on the SAME PostgreSQL connection
as Google challenge deletion and required `recovery_code_used` audit (purpose
`authentication`). Audit follows native insertion inside the transaction; neither
can commit alone. Only after COMMIT is the canonical session cookie forwarded.
Session/audit failure rolls back code, challenge, session and event. Successful
completion deletes the auxiliary native state. Existing native verification lookup
cleanup removes expired records opportunistically; no new worker is introduced.

One Google challenge allows at most one committed session, including across
concurrent requests/instances. Native conclusive invalid-proof errors are caught
inside the transaction only to commit failure counters, returning denial after
commit. Storage/crypto/audit errors abort it. Native five-attempt challenge budgets,
ten failures followed by a fifteen-minute account lock, and reset after valid proof
remain. Exhaustion invalidates the Google challenge. No automatic suspicious/repeated
incident classification is inferred from these counters. The separate durable
failure writer remains available for a later reviewed classification policy.

The new routes add native source throttling of five requests per route per minute
where native rate limiting is enabled (production). An always-on bounded application
limiter shares five attempts per Google credential per sliding minute across both
methods (10,000 live keys; saturation denies rather than evicting live entries).
Memory limits reset on restart and are single-instance; the native database-backed
challenge/account budgets remain effective across instances.

The resulting session is ordinary: seven-day rolling expiry, one-day refresh
threshold and thirty-day absolute maximum, with normal logout/revocation and
AuthSessionReader resolution. It issues no elevation/step-up or tenant/role/owner
state. Another session's assurance cannot transfer. Administration still needs
explicit elevation; ownership transfer needs elevation and recent step-up.

The permanent native Google TOTP-bypass characterization remains UNACCEPTED.
`better-auth/better-auth#10387` remains the separate accepted temporary reuse of a
still-valid TOTP across independent challenges; it does not permit same-challenge
replay, recovery replay or duplicate sessions. No schema, migration, dependencies,
Better Auth-owned fields or algorithms changed; migration history ends at 0011.

Before any production Google activation: review public callback adaptation/wiring,
initiation/callback source throttling, OAuth state/redirect coverage at that public
boundary, and applicable authentication-failure event classification/emission.
Internal bridge state/PKCE/fixed destinations, collision rejection, linking gates
and factor completion are covered; public activation is a separate decision.
