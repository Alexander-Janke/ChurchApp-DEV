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
deferred; a submitted client label cannot extend web lifetimes. Privileged elevation
and critical step-up are also deferred, as are client login/session-management UIs.

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
Password updates emit limited security event metadata and queue a change notice.
The native reset notification hook runs after the password write, before session
revocation, so it records an update rather than claiming the whole reset completed.

Native password writes, token consumption and session deletion are not one atomic
application transaction. A storage failure can leave a changed password with
incomplete revocation; no successful response is claimed. A consumed reset token is
not restored: the user must request another recovery link. These failure paths are
tested; production recovery UX and durable audit delivery remain future work.

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
unverified/pending/verified/rejected/revoked (default unverified). No lifecycle or
verification transition API is implemented. Both timestamps are UTC instants.

ChurchModule is an internal, unmounted Nest module exporting ChurchService, with no
controllers or client contracts. Its repository requires both TenantContext and a
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