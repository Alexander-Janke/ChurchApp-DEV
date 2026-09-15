# Church Platform – Testing and Quality Specification

## 1. Purpose

This document defines the mandatory testing and quality requirements for the Church Platform.

The goal is not only to verify that features work.

Tests must also prove that:

- tenant isolation works
- permissions work
- sensitive data remains protected
- regressions are detected
- database changes are safe
- critical workflows remain functional
- web and mobile builds remain healthy
- background jobs behave correctly
- production deployments are not based on unverified code

A feature is not complete simply because it appears to work manually.

---

# 2. Quality Principles

The project follows these principles:

1. Test important behavior, not implementation trivia.
2. Security boundaries require automated tests.
3. Negative tests are mandatory.
4. Tenant isolation is release-critical.
5. Permission changes require regression tests.
6. Important business rules belong in automated tests.
7. Critical workflows should have end-to-end coverage.
8. Tests must be deterministic.
9. Tests must not depend on production data.
10. Failing tests must not be ignored to make CI pass.
11. Test code is production-quality project code.
12. New features should include tests in the same change.

---

# 3. Test Layers

Use several complementary test layers.

Recommended categories:

- static analysis
- unit tests
- service/domain tests
- integration tests
- database tests
- authorization tests
- tenant isolation tests
- API tests
- background job tests
- frontend component tests
- end-to-end tests
- security-focused tests

Not every feature requires every test type.

The test strategy should match the risk of the feature.

---

# 4. Test Pyramid

Prefer many fast tests and fewer expensive end-to-end tests.

Conceptual structure:

```text
           End-to-End Tests
          /                \
       Integration / API Tests
      /                      \
   Service / Domain / Unit Tests
  /                            \
Static Analysis / Lint / Type Checks
```

Do not attempt to verify every edge case only through slow browser tests.

---

# 5. Mandatory Checks Before Completion

For a significant implementation, Codex must run all relevant available checks.

At minimum consider:

- formatter
- linter
- type checking
- backend build
- web build
- Flutter analysis
- unit tests
- integration tests
- authorization tests
- tenant isolation tests
- database migration tests
- relevant end-to-end tests

Codex must not claim a task is complete if known relevant checks are failing.

---

# 6. Definition of Done

A feature is complete only when applicable requirements are satisfied.

At minimum:

- code builds successfully
- formatting passes
- linting passes
- type checks pass
- relevant tests pass
- tenant isolation remains intact
- authorization checks are covered
- loading states are handled
- empty states are handled
- error states are handled
- permission-denied states are handled
- accessibility considerations are handled
- no sensitive information is exposed in logs
- database migrations are included where needed
- documentation is updated where behavior changed

---

# 7. Unit Tests

Unit tests should cover isolated business logic.

Examples:

- duty fairness calculation
- date calculations
- eligibility rules
- event capacity calculations
- membership state transitions
- permission helpers
- validation functions
- notification preference logic
- waitlist ordering

Unit tests should:

- be fast
- avoid unnecessary infrastructure
- avoid network access
- have clear inputs and expected outputs

---

# 8. Domain and Service Tests

Important business behavior should be tested at the domain/service layer.

Examples:

- accepting a membership request
- assigning a duty
- requesting a replacement
- moving a participant from waitlist to confirmed
- transferring church ownership
- converting a child profile to an independent account
- removing a member from active planning
- creating notifications for an important message

These tests should verify business invariants.

---

# 9. Integration Tests

Integration tests verify multiple real application components working together.

Examples:

- API + database
- service + repository layer
- background job + database
- authentication + authorization
- file metadata + object storage abstraction

Prefer realistic integration tests for security-critical data access.

---

# 10. Database Tests

Database-dependent behavior must be tested against the actual database technology where practical.

Primary database:

PostgreSQL

Do not rely only on a simplified in-memory database if PostgreSQL-specific behavior matters.

Examples:

- foreign keys
- unique constraints
- transaction behavior
- locking
- indexes
- JSON behavior
- concurrent operations

---

# 11. Migration Tests

Database migrations must be testable.

CI should verify where practical:

1. empty database can migrate to latest version
2. migrations apply successfully in order
3. application starts against migrated schema

For important schema changes, also test upgrade behavior from a representative earlier schema state.

Destructive migrations require additional review.

Task 1.2 extends `pnpm api:test:db` with a uniquely named disposable database
created from `template0`, using the configured local/CI PostgreSQL server. The
**test-only role needs CREATEDB**; this is not a requirement for production runtime
credentials. Tests migrate through Drizzle's migration runner, repeat migration,
start AuthModule with default schema validation, query all four models through the
real Better Auth adapter, and verify unique email/token constraints, lookup indexes,
foreign keys and cascading deletion. Synthetic constraint fixtures are rolled back.
Cleanup drops only the uniquely generated database, never the database named in
`DATABASE_URL`.

Task 1.3 adds a separate disposable database for canonical registration/verification
HTTP tests using a test-only in-memory email sender. Coverage includes credential
account/hash storage, email case normalization and duplicate responses, protected
fields, password limits, safe callbacks, absent pre-verification sessions, rejected
unverified sign-in, generated-link verification, invalid/expired links, and explicit
verified sign-in. Captured messages are reset between tests and never written to
disk; hash/credential assertions avoid printing their values. Native verification
tests assert the accepted Better Auth 1.7.4 semantics: no verification-table row is
required, invalid signatures and expired tokens fail, first use verifies the email,
and repeat use is idempotent without duplicate users/accounts, other identity-state
changes or sessions. No tenant/role/permission state exists in this foundation.
Do not require database token consumption or strict failure on a second valid use.
Verification JWTs are not sessions; explicit sign-in persists an opaque PostgreSQL
session. Fast tests also cover unavailable production delivery,
test-only capture restrictions, configuration and sanitized diagnostics.

Task 1.4 adds disposable-PostgreSQL session tests through the actual Nest/Better Auth
HTTP boundary: verified/unverified/incorrect/malformed login, opaque database
credentials, safe JSON and cookie attributes, current/missing/revoked sessions,
logout deletion (including simulated deletion failure), concurrent sessions, own
session listing, and single/other/all revocation with cross-user isolation. Single
revocation uses a non-secret `sessionId`; raw-token requests are rejected. Stored
tokens and cookies stay in test memory and sensitive assertions use booleans.
The earlier verification/sign-in regression now checks the credential in PostgreSQL
and the cookie rather than requiring its unsafe presence in browser JSON.

Controlled clocks test just-before/exactly-at/just-after 30 days, inactivity expiry,
sliding refresh without creation-time changes, expired list filtering, and server
API as well as HTTP enforcement. SQL fixtures explicitly interpret canonical
timestamp-without-time-zone values as UTC, independent of the Windows host zone.
Fast tests cover policy boundaries, configuration, cookie attributes (including
production), and protected sign-in fields. The pinned schema generator must still
match Task 1.2; no session columns or migrations are added. Mobile, privileged
elevation and step-up tests become mandatory with those future implementations.

Task 1.5 adds a separate disposable PostgreSQL password suite. It covers native
current-password checks, 12–128 limits, reuse rejection, forced other-session
revocation with the initiating creation time preserved, cross-user isolation,
generic reset responses, trusted callbacks, blocked-provider timing behavior,
one-hour verification-record lifecycle, invalid/expired/consumed tokens, concurrent
single-use consumption, all-session revocation, stable user/account counts and
non-plaintext hashing. It rejects implicit password creation for an identity without
a credential, including the native server-only set-password API. Injected deletion
failures must not report success. All prior
registration/verification/session tests remain mandatory and unchanged.

Fast password tests cover shared configuration, request policy, production sender
failure, redirect validation, distinct email captures, tracked pending delivery,
graceful draining and sanitized failure logs. The delayed-sender integration test
holds delivery unresolved while the HTTP response succeeds; it does not assert
fragile equal wall-clock durations for database operations. Tokens, hashes and URLs
stay in process memory and are not snapshotted. The pinned schema comparison must
remain identical; no new migration is generated.

Task 1.6 adds focused policy/router tests and disposable PostgreSQL workflow tests.
The permanent address-reassignment regression supersedes an older request, completes
the newer request, registers a different user at the released old address, then proves
both stale approval and stale verification fail without changing either user or
creating a session. Additional coverage includes verified/unverified current address,
hashes-only storage, exact expiry, single-use concurrency, destination races, identity
and session isolation, Origin/POST/protected fields, failed delivery retry, notification
failure, and clean/repeated migration. Actual router-limit tests explicitly enable
in-memory limiting. Native changeEmail remains disabled. The custom workflow table
must never appear in Better Auth's generated core schema; see ADR 0007.

Fast API tests check Better Auth's default schema validation without database I/O.
This checks Drizzle metadata, not PostgreSQL catalogs; the real integration tests
cover the physical schema. Existing health/auth-route and JSON parsing tests remain
required. Generator reproduction instructions are in `ARCHITECTURE.md`.

For manual validation, point `DATABASE_URL` at a new disposable local database,
run `pnpm db:migrate` twice, then `pnpm db:check`. The second migration run should
skip already applied entries. To reverse this initial migration during development,
discard and recreate only that disposable database, then replay the reviewed
migration history. Never reset a shared or production database this way. Drizzle
does not provide an automatic down migration here; applied shared/production
migrations need a deliberate reviewed forward correction or recovery plan.

---

# 12. Mandatory Tenant Isolation Tests

Tenant isolation tests are mandatory.

This is one of the most important testing rules in the project.

For every service, API, or repository accessing church-specific data, tests must prove that one tenant cannot access another tenant's protected data.

From the first real tenant-owned tables/services, use real PostgreSQL and the actual runtime role to test RLS reads/writes, cross-tenant constraints, missing/incorrect context, and pooled/concurrent connection isolation. Cover bulk operations, joins, aggregates, search, and exports as introduced. The mandatory matrix is defined in [ADR 0006](adr/0006-tenancy-and-authorization.md); these tests must not wait for later product phases. Positive public/follower tests must also prove that legitimate access does not require membership.

---

# 13. Standard Tenant Test Pattern

For tenant-specific functionality, create at least:

```text
Tenant A
Tenant B

User A → belongs to Tenant A
User B → belongs to Tenant B

Resource A → belongs to Tenant A
Resource B → belongs to Tenant B
```

Then verify:

```text
User A can access Resource A
User A cannot access Resource B

User B can access Resource B
User B cannot access Resource A
```

Changing IDs manually must not bypass authorization.

---

# 14. Tenant Tests Are Release Blocking

If a tenant isolation test fails:

- the relevant feature is not complete
- CI must fail
- production deployment must not proceed

Do not mark tenant tests as optional or flaky.

---

# 15. Cross-Tenant Test Coverage

Tenant isolation tests should cover where applicable:

- read
- create
- update
- delete
- search
- exports
- file downloads
- realtime subscriptions
- notifications
- background jobs
- bulk operations

Do not test only GET endpoints.

---

# 16. Authorization Tests

Every protected feature must test permissions.

At minimum include:

- authorized user succeeds
- unauthorized user fails
- wrong tenant fails
- wrong object scope fails
- revoked permission fails

---

# 17. Positive and Negative Permission Tests

Do not write only positive tests.

Bad example:

```text
Main Admin can update church settings.
```

Also test:

```text
Member cannot update church settings.
Follower cannot update church settings.
Group Leader cannot update church settings.
Admin from another tenant cannot update church settings.
```

---

# 18. Object-Level Authorization Tests

Object-scoped roles require dedicated tests.

Examples:

## Group Leader

Verify:

```text
Leader of Group A can manage Group A.
Leader of Group A cannot manage Group B.
```

## Event Administrator

Verify:

```text
Admin of Event A can manage Event A.
Admin of Event A cannot manage Event B.
```

## Area Leader

Verify:

```text
Leader of Area A can plan duties in Area A.
Leader of Area A cannot manage Area B.
```

## Parent

Verify:

```text
Parent can manage linked child.
Parent cannot access unrelated child.
```

---

# 19. Privilege Escalation Tests

Test that users cannot grant themselves stronger permissions.

Examples:

- member assigns self admin
- admin grants self Primary Owner
- church admin grants self platform superadmin
- Area Leader assigns ownership permission
- user modifies request body to include protected role

All such attempts must fail.

---

# 20. Primary Owner Tests

Test critical ownership rules.

At minimum:

- exactly one Primary Owner exists
- Main Admin cannot remove Primary Owner
- Main Admin cannot transfer ownership
- Primary Owner can initiate valid transfer
- invalid receiving user is rejected
- cross-tenant ownership transfer fails
- ownership transfer is atomic
- audit event is created

---

# 21. Authentication Tests

Authentication tests are release-critical. Apply the full positive/negative matrix in [ADR 0003](adr/0003-authentication-and-sessions.md) against the installed Better Auth/adapter boundary, including Google/Apple, social-only accounts, safe explicit linking, rejected email-only automatic linking, cookie/mobile transport, CSRF/Origin, rate limiting, and absence of secrets from logs. Use controlled clocks and provider test doubles; real PostgreSQL is required when session persistence or revocation behavior matters.

Authentication tests should cover:

- registration
- email verification
- valid login
- invalid password
- password reset
- password reset token expiry
- password reset token single-use behavior
- successful password reset revokes all existing browser/mobile sessions and assurance state
- logout
- session revocation
- multiple sessions
- email change verification

---

# 22. 2FA Tests

When 2FA is implemented, test:

- enrollment
- valid code
- invalid code
- expired/old code where applicable
- recovery code
- recovery code single-use
- 2FA removal
- mandatory 2FA capability enforcement, including custom privileged roles

Mandatory roles include:

- Primary Owner
- main church administrators
- platform superadmins

---

# 23. Session Tests

Verify the separate web/mobile inactivity and absolute limits, 15-minute/eight-hour elevation limits, and five-minute step-up window from ADR 0003. Test that social login cannot bypass mandatory 2FA, disabling/resetting factors cannot leave unprotected privileges usable, and Primary Owner critical actions require current assurance. Session rotation/renewal must not reset absolute lifetime or manufacture recent authentication.

Test:

- active session accepted
- revoked session rejected
- expired session rejected
- logout invalidates intended session
- logout-all invalidates intended sessions
- deleted/disabled account cannot continue using old session

---

# 24. Sensitive Data Tests

Highly sensitive data needs explicit access tests.

Examples:

- child medical information
- allergies
- emergency contacts
- pickup permissions
- administrative member notes
- private prayer content
- direct messages
- Bible notes

For each sensitive resource, test both:

- permitted access
- denied access

---

# 25. Child Data Tests

At minimum test:

```text
Parent → own linked child → allowed
Parent → unrelated child → denied

Authorized worker → assigned child/event → allowed where permitted
Worker → unrelated child/event → denied

Normal member → child medical data → denied

Superadmin → child medical data → denied by default
```

---

# 26. Private Content Tests

Test that protected private content cannot be accessed through alternate paths.

Examples:

Private direct message must not appear via:

- generic search
- admin member API
- superadmin content listing
- logs
- notifications containing full private content

Private Bible note must not appear via church admin APIs.

Private prayer request must not appear in public or unauthorized feeds.

---

# 27. Search Security Tests

Search tests must verify that search does not leak restricted resources.

Examples:

A user must not discover:

- hidden group names
- private prayer titles
- restricted event names
- administrative notes
- child information
- unauthorized members
- private messages

Also test search suggestions/autocomplete where implemented.

---

# 28. Response Filtering Tests

API responses must return only allowed fields.

Example:

A normal member directory request may return:

```text
username
profile picture
permitted profile fields
```

It must not accidentally return:

```text
admin notes
medical information
private address
protected phone number
internal flags
```

Use explicit tests for sensitive response DTOs.

---

# 29. Validation Tests

Every API boundary should have validation tests.

Test:

- missing required field
- invalid enum
- invalid identifier
- too-long string
- invalid date
- invalid relationship
- unexpected protected field
- malformed payload

Do not only test valid requests.

---

# 30. Mass Assignment Tests

Test that request payloads cannot update protected fields.

Example malicious request:

```json
{
  "displayName": "Test",
  "isSuperAdmin": true
}
```

Unknown fields and protected fields outside the accepted request DTO must be rejected.

It must never modify privileges.

---

# 31. Event Tests

Event tests should cover relevant functionality such as:

- creation
- editing
- audience eligibility
- registration
- cancellation
- capacity
- waitlist
- pricing categories
- payment status
- guest registration
- age restrictions
- check-in
- event administrator scope

---

# 32. Event Capacity Concurrency Tests

Critical capacity logic should test concurrent behavior.

Example:

Event has one remaining place.

Two users attempt to register at nearly the same time.

Expected:

- only one receives the final confirmed place
- the other receives correct waitlist/full behavior
- capacity is never exceeded

---

# 33. Waitlist Tests

Test:

- correct ordering
- participant cancellation
- automatic advancement where enabled
- advancement does not exceed capacity
- duplicate advancement does not occur
- retries remain idempotent

---

# 34. Duty Planning Tests

Test:

- eligible member selection
- skill requirements
- absence handling
- desired frequency
- conflicts
- cross-church conflicts where applicable
- fairness hints
- replacement requests
- assignment scope

---

# 35. Automatic Duty Planning Tests

Rule-based automatic planning must be deterministic enough to test.

Test:

- only eligible people considered
- unavailable people excluded
- skill requirements honored
- conflicts detected
- workload considered
- result remains draft
- no automatic publishing occurs
- reason returned when no eligible person exists

---

# 36. Group Tests

Test:

- group creation
- visible/hidden behavior
- joining modes
- join request handling
- group leader scope
- member removal
- file access
- group chat authorization
- group prayer authorization

---

# 37. Membership Tests

Test:

- follow church
- membership request
- request acceptance
- request rejection
- follower-to-member transition
- no duplicate person relationship
- inactive status
- left-church status
- loss of active permissions after leaving

---

# 38. Member Removal Tests

When a member leaves or is removed, test that access is removed from:

- internal feed
- member directory
- groups
- duties
- files
- internal prayer content

unless another valid relationship explicitly grants access.

---

# 39. Notification Tests

Test:

- intended recipient receives notification
- unauthorized user does not receive notification
- user preference respected
- security notifications bypass optional disable settings where designed
- revoked access prevents sensitive content opening
- notification creation is idempotent where necessary

---

# 40. Push Notification Privacy Tests

For sensitive contexts, test that push payloads do not expose unnecessary private information.

Prefer generic notification previews for:

- direct messages
- sensitive child information
- private prayer content

---

# 41. Background Job Tests

Background jobs should test:

- successful execution
- retry behavior
- idempotency
- permanent failure handling
- correct tenant scope
- no duplicate side effect

Examples:

- emails
- push notifications
- imports
- scheduled feed publishing
- deletion jobs
- reminders

---

# 42. Idempotency Tests

If a job or API may be retried, test repeat execution.

Example:

A notification job runs twice.

Expected:

- no unintended duplicate message if operation is intended to be exactly-once from user perspective

Idempotency requirements depend on the operation.

---

# 43. File Upload Tests

Apply the [ADR 0004](adr/0004-object-storage.md) test matrix with each storage flow: authorized/unauthorized and wrong-tenant uploads/downloads, key/ownership manipulation, separate audio quota and concurrency, actual size/type validation, incomplete-upload cleanup, deleted-resource denial, signed scope/expiry, sensitive-file policy, and provider-adapter contracts. Tenant-isolation tests remain release-critical.

Test:

- valid file accepted
- unsupported type rejected
- oversized file rejected
- unsafe filename handled
- malicious path sequences ignored
- private file access protected
- cross-tenant file access denied

---

# 44. File Authorization Tests

Example:

```text
User A belongs to Group A.
File A belongs to Group A.

User A → File A → allowed.

User B has no Group A access.
User B → File A → denied.
```

Possession of an object key or guessed URL must not bypass authorization.

---

# 45. Import Tests

Test imports with:

- valid file
- invalid file
- missing columns
- invalid values
- duplicate data
- wrong tenant references
- very large import within supported limit
- formula-like spreadsheet values where relevant

Imports must never create data in another tenant.

---

# 46. Export Tests

Test:

- authorized export succeeds
- unauthorized export denied
- export contains only correct tenant data
- sensitive fields follow permission rules
- generated link is protected
- link expires where designed

---

# 47. Deletion Tests

Test account and church deletion workflows.

Examples:

- deletion request creation
- protection/transition period
- cancellation where supported
- final processing
- anonymization
- retained historical references
- permission requirements
- audit event

---

# 48. Audit Log Tests

Test that critical actions create audit records.

Examples:

- role assignment
- role removal
- ownership transfer
- member status change
- sensitive access where required
- export
- church deletion request
- recovery action

Also verify that audit records do not store secret values.

---

# 49. Audit Immutability Tests

Normal application permissions must not allow historical audit records to be silently edited or deleted.

Where audit retention cleanup exists, it must use a controlled process.

---

# 50. API Tests

API tests should verify:

- status codes
- response schemas
- validation behavior
- authentication
- authorization
- tenant isolation
- response filtering
- pagination
- error format

---

# 51. Error Contract Tests

API errors should use a consistent structure.

Example:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action."
  }
}
```

Tests should avoid relying excessively on human-readable message text where stable error codes are available.

---

# 52. Pagination Tests

For paginated endpoints test:

- first page
- next page
- empty page
- page size limits
- stable ordering
- tenant filtering
- authorization filtering

No page may expose unauthorized records.

---

# 53. Frontend Component Tests

Use component tests for reusable UI behavior.

Examples:

- permission-aware navigation
- forms
- validation messages
- loading states
- error states
- empty states
- dialogs
- important message confirmation
- event registration components

Do not over-test static markup.

---

# 54. Web Tests

Web application checks should include where applicable:

- formatting
- linting
- TypeScript checks
- unit/component tests
- production build

A feature that works in development mode but fails production build is not complete.

---

# 55. Flutter Tests

Mobile checks should include where applicable:

- formatting
- static analysis
- unit tests
- widget tests
- integration tests

The application should build for supported targets as part of release validation.

---

# 56. Accessibility Tests

Automated accessibility checks should be used where practical.

Web examples:

- missing labels
- invalid ARIA
- keyboard issues
- contrast warnings where tooling supports it

Manual accessibility review is still required for important workflows.

---

# 57. Localization Tests

Test that:

- German works
- English works
- Portuguese works
- untranslated keys are detectable
- layouts tolerate longer translations
- dates and times display appropriately
- hardcoded UI strings are minimized

---

# 58. Time Zone Tests

Event and calendar functionality should include tests for time zones.

Examples:

- event stored consistently
- display correct for user
- recurring event behavior
- daylight-saving transitions

Do not assume server local time.

---

# 59. End-to-End Tests

End-to-end tests should cover critical user journeys.

They should not attempt to test every combination.

The initial browser/API foundation lives in `tests/e2e` and uses Playwright
with Chromium. It currently verifies only the main web shell, platform-admin
shell, and API health endpoint on local ports 3000, 3002, and 3001. It does not
require PostgreSQL and will expand alongside implemented product workflows.

Initial critical E2E scenarios should eventually include:

1. user registration and login
2. church creation
3. church membership request and acceptance
4. role assignment
5. event creation and registration
6. group membership
7. duty request and acceptance
8. child registration/check-in
9. important message confirmation
10. permission denial for unauthorized user

---

# 60. Tenant Isolation E2E Test

At least one E2E security scenario should explicitly use two churches.

Example:

```text
Create Church A.
Create Church B.

Create Admin A.
Create Admin B.

Admin A creates private event in Church A.

Admin B manually navigates to Event A URL/API resource.

Expected:
Access denied.
```

This complements lower-level isolation tests.

---

# 61. Test Data

Automated tests must use:

- factories
- fixtures
- synthetic accounts
- deterministic fake data

Do not depend on real users or production records.

---

# 62. Test Factories

Create reusable factories for common entities.

Examples:

- platform user
- church
- membership
- role
- permission
- group
- event
- duty
- child
- registration

Factories should make security tests easy to understand.

---

# 63. Test Isolation

Tests should not depend on execution order.

Each test must establish its own required state or use reliable setup helpers.

Avoid hidden shared mutable state.

---

# 64. Test Cleanup

Integration tests should clean up safely or use isolated databases/schemas.

A failed test must not corrupt later tests.

Parallel execution should be considered when designing test data.

---

# 65. Deterministic Tests

Avoid unnecessary randomness.

When random values are needed:

- seed randomness where possible
- record failing seed
- avoid time-dependent nondeterminism

---

# 66. Time-Based Tests

Use controllable clocks where possible for logic involving:

- expiry
- reminders
- scheduled posts
- deletion periods
- registration deadlines
- prayer expiry

Do not fill tests with long real waits.

---

# 67. External Provider Tests

Third-party systems should normally be abstracted.

Examples:

- email provider
- push provider
- object storage
- OAuth providers

Unit/integration tests should use controlled fakes or test environments.

Do not send real customer emails from automated tests.

---

# 68. Contract Tests

Where external service abstractions are important, use contract tests or adapter tests.

Examples:

- object storage adapter
- email adapter
- push notification adapter

This reduces provider lock-in.

---

# 69. Performance Tests

Do not prematurely create large performance suites.

However important endpoints should avoid obvious performance regressions.

Candidate scenarios later include:

- member directory
- feed
- calendar
- global search
- event registrations
- large churches

Measure realistic workloads before optimizing.

---

# 70. N+1 Regression Tests

Where the data access framework permits useful detection, protect important list endpoints against obvious N+1 query regressions.

Examples:

- member lists
- event lists
- group lists
- duty planning views

---

# 71. Load and Stress Testing

Before substantial production scale, perform load tests for high-volume flows.

Potential scenarios:

- Sunday morning app usage
- push notification fan-out
- popular event registration opening
- church-wide important message
- large import

This is not required for every development task.

---

# 72. Security Scanning

CI should include appropriate automated security checks.

Consider:

- dependency vulnerability scanning
- secret scanning
- static security analysis
- container image scanning
- dependency update automation

These tools complement tests; they do not replace authorization tests.

---

# 73. Secret Scanning

Repository checks should detect likely committed secrets.

A detected real secret must be considered compromised.

Removing it from the latest commit alone is not sufficient.

Rotate the secret where necessary.

---

# 74. Dependency Updates

Automated dependency updates may create pull requests.

They must run the normal test suite.

Do not auto-merge major security-sensitive dependency changes without appropriate validation.

---

# 75. CI Pipeline

The target pull request pipeline should conceptually run:

```text
Checkout
   ↓
Install dependencies
   ↓
Formatting check
   ↓
Lint
   ↓
Type/static analysis
   ↓
Unit tests
   ↓
Integration tests
   ↓
Authorization tests
   ↓
Tenant isolation tests
   ↓
Build
   ↓
Relevant E2E tests
   ↓
Security checks
```

Exact jobs may run in parallel.

The initial GitHub Actions workflow is `.github/workflows/ci.yml`. It runs four
focused jobs: TypeScript validation covers formatting, contracts, the API, the
web app, and the platform-admin app; PostgreSQL integration CI uses a disposable
`postgres:18.6` service for the API integration suite; Flutter CI runs
`flutter pub get`, formatting verification, analysis, and tests; and Playwright
E2E CI installs Chromium with its supported Linux dependencies before running the
web, admin, and API health checks. The workflow does not require repository
secrets and does not build mobile binaries.

---

# 76. Monorepo CI

CI should run only necessary work where practical.

Examples:

A Flutter-only change may not need every unrelated backend test if dependency analysis safely proves independence.

However security-critical shared code changes should trigger all relevant test suites.

Do not over-optimize CI at the expense of reliability during early development.

---

# 77. Pull Request Requirements

A pull request should not be merged when:

- required CI is failing
- required tests were skipped without explanation
- security-critical TODOs remain
- unresolved migration failure exists
- tenant isolation tests fail
- authorization tests fail

---

# 78. Flaky Tests

Flaky tests must be treated as defects.

Do not normalize repeatedly retrying unreliable tests indefinitely.

If a test is flaky:

1. investigate cause
2. fix it
3. only temporarily quarantine if absolutely necessary
4. document the reason

Security tests should not be casually quarantined.

---

# 79. Skipped Tests

Skipped tests require a reason.

Do not commit large amounts of:

```text
skip
disabled
todo
```

to make a suite green.

Security and tenant tests may not be silently disabled.

---

# 80. Test Coverage

Code coverage may be measured.

Coverage percentage is a signal, not the main goal.

Do not write meaningless tests merely to increase coverage.

High-risk code should receive stronger coverage.

Examples:

- permissions
- tenant filtering
- authentication
- child data
- ownership transfer
- event capacity
- payment status logic
- deletion flows

---

# 81. Regression Tests

Every confirmed bug should normally receive a regression test when practical.

Process:

1. reproduce bug with failing test
2. implement fix
3. confirm test passes
4. keep test permanently

This is especially important for security bugs.

---

# 82. Bug Reproduction

Codex should attempt to reproduce reported defects before making broad changes.

Do not rewrite large modules solely because a bug is unclear.

Prefer targeted diagnosis.

---

# 83. Test Naming

Test names should describe behavior.

Good:

```text
denies event update when admin belongs to another tenant
```

Poor:

```text
testEvent2
```

Security tests should make the boundary obvious.

---

# 84. Arrange / Act / Assert

Tests should generally be easy to read.

Recommended conceptual form:

```text
Arrange
Act
Assert
```

Avoid heavily abstracted test helpers that hide the security scenario.

---

# 85. Test Assertions

Assert meaningful outcomes.

Example:

Do not only assert:

```text
HTTP status != 500
```

Instead assert:

```text
HTTP 403
resource unchanged
no audit action claiming success
```

where appropriate.

---

# 86. Database State Assertions

For mutation operations, verify both response and resulting state.

Example:

Unauthorized member deletion request:

- returns forbidden
- member still exists
- membership state unchanged

---

# 87. Side Effect Assertions

Important operations may have side effects.

Examples:

Accept membership request may:

- update request
- create membership
- create notification
- create audit record

Tests should validate important side effects.

---

# 88. Transaction Tests

Operations using transactions should test failure behavior where practical.

Example:

Ownership transfer fails midway.

Expected:

- old owner remains owner
- new owner does not partially gain ownership
- tenant still has exactly one Primary Owner

---

# 89. Concurrency Tests

Use concurrency tests for high-risk race conditions.

Examples:

- final event place
- waitlist promotion
- ownership transfer
- claiming limited helper slots
- duplicate membership acceptance

---

# 90. Realtime Tests

Apply [ADR 0005](adr/0005-realtime.md) to actual NestJS/Socket.IO integration and shared authorization. Include negative room/private-object tests, session/membership/permission revocation, reconnect/API state recovery, duplicate/out-of-order tolerance, and graceful operation without realtime. Multi-instance and broker-failure tests become mandatory when Redis scaling is introduced, not before it is needed.

When realtime features are implemented, test:

- authorized connection
- unauthorized channel denied
- wrong tenant denied
- permission revocation
- disconnected session
- event delivery to correct audience

---

# 91. Chat Tests

Chat testing should include:

- valid conversation participant
- non-participant denied
- group chat access
- removed group member behavior
- block behavior
- report behavior
- private message data not exposed in logs/admin endpoints

---

# 92. Moderation Tests

Test:

- authorized moderation
- unauthorized moderation denied
- tenant boundaries
- report workflow
- audit events
- platform escalation where implemented

---

# 93. Feature Flag Tests

If feature flags are used:

- disabled feature should not be accidentally accessible through API
- enabled feature works
- permission checks still apply

Feature flags never replace permissions.

---

# 94. Offline Behavior Tests

When offline caching exists, test important behavior such as:

- loaded data readable offline where intended
- sensitive write clearly fails/queues according to design
- reconnect refresh works
- stale authorization does not grant new server access

---

# 95. Compatibility Tests

Support current intended platform versions.

Avoid maintaining unnecessary compatibility with obsolete browser/mobile versions unless explicitly required.

Browser support policy should be documented once chosen.

---

# 96. Staging Verification

After successful CI and staging deployment, verify critical changes in staging.

Possible checks:

- application starts
- migrations succeeded
- login works
- changed feature works
- authorization still works
- no obvious runtime errors

Staging verification complements automated CI.

---

# 97. Production Smoke Tests

After production deployment, run safe smoke checks.

Examples:

- health endpoint
- public web app loads
- login entry point works
- API responds
- database connectivity healthy
- worker healthy

Do not run destructive tests against production.

---

# 98. Monitoring After Deployment

Deployment completion does not end verification.

Monitor:

- error rate
- failed jobs
- health checks
- database errors
- authentication failures
- performance anomalies

Rollback should be available for serious regressions.

---

# 99. Codex Workflow for Feature Development

Before coding a significant feature, Codex should:

1. read relevant documentation
2. inspect existing code
3. identify security boundaries
4. identify permissions
5. identify tenant scope
6. identify database changes
7. identify required tests
8. create concise implementation plan

Then:

9. implement code
10. add or update tests
11. run formatter
12. run lint/static checks
13. run relevant unit tests
14. run relevant integration tests
15. run authorization tests
16. run tenant isolation tests
17. run build checks
18. run E2E tests where applicable
19. inspect failures
20. fix failures
21. rerun relevant checks
22. inspect git diff
23. summarize implementation and test results

---

# 100. Codex Completion Report

For significant coding tasks, Codex should report:

- what changed
- important architectural decisions
- database migrations
- permissions added/changed
- tests added/changed
- commands/checks executed
- whether they passed
- any known limitations
- any unresolved risks

Do not report a test as passed if it was not executed.

Use language such as:

```text
Not run: Flutter integration tests because the required emulator was unavailable.
```

instead of pretending success.

---

# 101. No Fake Verification

Codex must never claim:

- tests passed
- build passed
- migration works
- deployment works

unless the relevant command or verification was actually performed.

If an environment prevents execution, report that clearly.

---

# 102. Critical Test Priority

When time or environment limits prevent every test from running, prioritize:

1. tenant isolation
2. authorization
3. authentication/security
4. critical business rules
5. database migrations
6. affected unit/integration tests
7. builds
8. UI and E2E tests

This does not permanently waive skipped tests.

---

# 103. Test Review Rule

Before finishing a feature, ask:

- What happens with another tenant?
- What happens with a weaker role?
- What happens with another user's resource?
- What happens when permission is revoked?
- What happens when input is invalid?
- What happens if the request happens twice?
- What happens if two requests happen concurrently?
- What sensitive data could leak?

Add tests where these questions reveal meaningful risk.

---

# 104. Initial CI Goals

During early project setup, prioritize getting these checks working first:

```text
Backend formatting/lint/type checking
Backend unit tests
Backend integration tests
Tenant isolation tests
Web formatting/lint/type checking/build
Flutter format/analyze/tests
```

E2E testing can grow alongside real user flows.

---

# 105. Future Test Infrastructure

As the project grows, consider:

- isolated CI PostgreSQL
- Redis test service
- object storage test service
- browser automation
- mobile integration testing
- test reporting
- coverage reports
- performance test environment

Introduce infrastructure as needed rather than all at once.

---

# 106. Testing Decision Rule

When deciding whether a test is needed, consider:

1. security impact
2. data sensitivity
3. tenant boundary
4. permission boundary
5. financial/administrative impact
6. concurrency risk
7. likelihood of regression
8. complexity of business rule

The higher the risk, the stronger the required automated testing.

---

# 107. Relationship to Other Documents

Product behavior:

`docs/PRODUCT.md`

Architecture:

`docs/ARCHITECTURE.md`

Security:

`docs/SECURITY.md`

Permissions:

`docs/PERMISSIONS.md`

Roadmap:

`docs/ROADMAP.md`

This document defines testing and verification expectations for implementation work.

---

# 108. Final Quality Rule

A feature is not done when the code exists.

A feature is done when:

```text
it works
+
it is authorized correctly
+
tenant isolation is proven
+
important failure cases are handled
+
relevant automated tests pass
+
the project still builds
```

For this platform, functional correctness without authorization and tenant-isolation testing is incomplete implementation.

## Task 1.8 profile regression coverage

Fast profile tests exercise canonical usernames, Unicode names and limits,
calendar dates, E.164 phones, structured address replacement, plain-text biography,
HTTPS image references, nullable/omitted values, protected fields and explicit
safe response mapping. Shared contract typecheck/tests/build preserve the
framework-independent public package boundary.

The canonical `pnpm api:test:db` suite includes profile tests on a uniquely named
disposable PostgreSQL database. Coverage includes lazy profiles, authenticated
self-only reads/writes, protected body/query IDs, Origin checks, concurrent
username claims, independent-field concurrency, atomic image/profile rollback,
database constraints/cascade, existing identities/credentials/sessions, absolute
session expiry, and migration repeat behavior. All previous password and
email-change attack regressions remain required. Migration expectations now
include 0000_auth_foundation, 0001_email_change_workflow, and 0002_user_profile;
repeat migration preserves auth, email-change and profile data.

Pinned Better Auth schema generation must reproduce only its unchanged core
schema. Application-owned email_change_request and user_profile are separately
exported by the application schema index, never added to generator-owned auth.ts.
TOTP remains blocked; these profile tests do not simulate verified 2FA or
authorize privileged capabilities.

## Task 1.9 restricted-role church tests

The canonical api:test:db suite adds a unique church_test database and a generated
church_runtime LOGIN role. DATABASE_URL identifies the fixture/migration connection
and must permit disposable database and role creation (the existing local/CI role
does). Generated runtime credentials exist only in test memory; both role and
database are removed afterward. Tests assert current_user=session_user equals that
restricted login, role privilege flags are false, and it is not the table owner or
a member of the owner role. A positive tenant-boundary rejection test intentionally
uses the privileged fixture connection; it never claims to prove RLS.

Release-blocking coverage includes scoped and raw broad reads/writes, missing/invalid
scope, repository A with database B, WITH CHECK, cross-tenant deletion, forbidden
TRUNCATE/RLS disabling, explicit predicates independently of RLS, canonical slug
constraints/conflicts, commit and rollback on reused connections, thrown/SQL errors,
and concurrent A/B transactions on distinct connections. Prior auth/profile/email
security suites remain required. Tenant fixtures are churches only, without invented
users' memberships, administrative roles or ownership entitlements.

Clean migrations now include 0000_auth_foundation, 0001_email_change_workflow,
0002_user_profile and 0003_church_tenant_foundation. Upgrade coverage preserves existing
auth/profile/email-change data and repeats migration without duplicate application.
Fast tests cover canonical field policies, enums, context branding and malformed
scope rejection. Better Auth 1.7.4 generation must still reproduce auth.ts unchanged;
all three application-owned tables stay outside the library generator.

## Task 1.10 membership regression coverage

Fast tests cover the four structural states, rejected invalid/protected input,
opaque IDs, bounded keyset pagination, explicit tenant/ID/expected-state predicates,
context-derived creation, safe duplicate results, retained row identity and sanitized
service failures. They do not model roles or authorize product workflows.

The canonical api:test:db suite includes disposable membership_test databases and
membership_runtime LOGIN roles following the Task 1.9 harness. Actual protected
queries use NOSUPERUSER/NOBYPASSRLS/non-owner connections; privileged credentials
only prepare fixtures/migrations and exercise explicit negative role checks.
Minimum relationship fixtures are Church A/B and User A/B, without administrators.

Release-blocking coverage includes independent broad SQL RLS, explicit repository
scope, known foreign IDs, A-repository/B-RLS mismatch, WITH CHECK inserts/ownership
rewrite, missing context, foreign keys, cascade, unique-pair concurrency, expected-state
update concurrency, ID/creation-time retention, commit/rollback/errors/pool reuse
and simultaneous A/B transactions. Tests also reject missing FORCE RLS or membership
table ownership at the shared boundary. Disposable databases/roles are removed afterward.

Migrations run 0000_auth_foundation, 0001_email_change_workflow, 0002_user_profile,
0003_church_tenant_foundation, then 0004_tenant_membership_foundation. A representative
upgrade preserves auth/email-change/profile/church data; repeat migration preserves
relationship data and now records six applied entries including Task 1.12.
Existing security suites
remain mandatory. Pinned Better Auth 1.7.4 generation must still reproduce its core
schema unchanged; church_membership remains application-owned.

## Task 1.11 reusable tenant harness

Use `createTenantTestFixture({ protectedTables: [...] })` from
`test/support/tenant/database-fixture.ts` in a suite's `beforeAll`; always await
`fixture.dispose()` in `afterAll`. There are no separate credential fields in the fixture API;
never log fixture/pool objects or raw driver errors.
The configured local/CI connection is maintenance-only; all migrated/seeded data
lives in the generated disposable database. Existing CI credentials already have
the database/role creation privileges required; CI configuration is unchanged.

Call `baseTenantFixtures()` once for `tenantA.churchId`,
`tenantB.churchId`, `userA.userId` and `userB.userId`.
Use `seedTenantFixtures(fixture.fixturePool, base, { memberships: true })`
in `beforeEach` when relationships are needed; otherwise omit the option.
This resets tenant rows and base users inside the disposable database only.
Module-specific preservation/setup queries remain in the calling suite.
An optional `upgrade` supplies a prior migration tag and before/after callbacks;
`migrateFixture` can also verify repeated full migration runs.

Use `fixture.withTenant(context, tx => ...)` for production-boundary operations
and `fixture.assertRestrictedRole()` to guard against privileged test mistakes.
The helpers in `tenant-isolation.ts` accept explicit caller-owned queries,
operations and expected rows:

- `assertScopedResult` and `assertUnscopedResult`: permitted/denied reads or writes.
- `assertRawRead`: broad raw query under A/B, followed by unscoped denial.
- `assertScopeMismatch`: repository scope A with database scope B, plus an
  independent unchanged-data assertion.
- `assertRejectedWrite`: WITH CHECK failure plus unchanged-data assertion.
- `assertCommitIsolation`: same backend PID, cleared context and no protected rows.
- `assertRollbackIsolation`: explicit PostgreSQL ROLLBACK on the same borrowed
  restricted connection. This low-level probe complements production-boundary
  callback/SQL exception tests; it is not an alternative application context API.
- `assertFailureIsolation`: real TenantDatabase rollback on application or SQL
  errors, unchanged writes, no protected rows and no borrowed clients afterward.
- `assertConcurrentIsolation`: two transactions must reach a bounded barrier
  before querying; distinct backend PIDs and both reused connections are checked.

Always release manually borrowed clients in `finally`; the shared helpers do so.
Concurrent probes drain both transactions before surfacing failure. Cleanup
self-tests check normal/repeated disposal and failures during seeding or grants;
real privilege-negative tests reject superuser, BYPASSRLS, CREATEDB, CREATEROLE,
table ownership and disabled FORCE RLS. Fast tests cover target/grant guards and
sanitized role diagnostics without mocking PostgreSQL security.

All 35 church and 40 membership cases remain, including duplicate creation/status
races, FK/cascade behavior and ownership rewrites. Run `pnpm api:test` for fast
tests and `pnpm api:test:db` for the full PostgreSQL dispatcher. New tenant modules
must adopt this harness or equivalent reviewed coverage; failures block release.

## Task 1.12 authorization regression coverage

The authorization suite reuses the Task 1.11 disposable tenant harness with all five
protected tenant tables. Restricted runtime login assertions cover role flags,
ownership and ENABLE/FORCE RLS. Broad raw reads, missing context, foreign writes,
repository/database scope mismatch, commit/rollback reuse and concurrent A/B
transactions exercise all three new tables. Privileged fixture connections are used
only for setup/inspection and explicitly identified composite-FK integrity probes,
never as evidence of RLS enforcement.

Permanent tests cover member allow, inactive opt-in/default deny, follower deny and
left deny despite retained role assignments. State changes use Task 1.10's existing
expected-state conditional update: member/inactive/member, member/follower and
member/left. Removal of assignments or role permissions takes effect immediately.
Other tenant assignments remain intact; unregistered keys fail closed even if a
fixture inserts one. System-role mutation protection, case-insensitive per-church
role uniqueness, duplicate/concurrent assignments, cascade boundaries and additive
permissions are tested without production role seeds.

The full migration chain is now 0000 through 0005_roles_permissions_foundation.
Upgrade coverage preserves existing auth, profile, email-change, church and
membership rows; repeated migration preserves authorization rows with six journal
entries. The pinned Better Auth schema comparison remains independent of these
application-owned tables. Existing auth/profile/church/membership tests remain
required. No privileged authorization is claimed while Task 1.7 is blocked.

## Task 1.7a preparation and blocker tests

`auth-two-factor.spec.ts` verifies the fixed false gate across test/development/
production configuration, endpoint allowlist, native rate-limit metadata, retained
schema/challenge hooks and safe 503 responses. `support/two-factor.integration.ts`
is registered only in the PostgreSQL suite and uses a fresh migrated disposable
DB and the application AuthModule. It verifies pending encrypted enrollment,
password/ownership/origin checks, absolute expiry, no-store and secret/log hygiene,
code rotation, explicit session rotation without absolute-age reset, user deletion,
real endpoint limiting and password/reset/email-change preservation.

An explicitly isolated native Better Auth instance exists only in that test file.
Its Date-only frozen clock records the known unsafe same-code/same-timestep result
across two independent challenges. The application counterpart rejects both valid
attempts, creates no session and returns no assurance. The native probe is an
expected blocker, not a passing claim of replay protection. Main CI stays green
because the shipped gate denies verification. Native backup probes require exactly
one concurrent success, safe loser rejection (401 or 409), sequential/unknown/
foreign-code rejection and old-code invalidation after rotation. Native-enabled
fixtures in this original probe originate from its isolated enrollment verifier.
Task 1.7b-1 separately tests the real authenticated enrollment-confirmation path;
production has no flag override or test user path.

All previous auth, email-change, profile and tenant/permission tests remain in the
suite. Migration checks now include 0000 through 0006, preserving prior fields and
rows while adding the generator-owned nullable/defaulted user flag. Re-running
migrations preserves factor material. Pinned schema generation uses the actual
application configuration; only canonical two-factor additions are expected.

Task 1.7b must replace the expected-native-blocker characterization only after an
approved fix passes independent sequential and concurrent replay tests and the
full authentication regression suite. Tests must never enable privileged features
or manufacture MFA assurance to bypass this requirement.

## Task 1.13 standard-role tests

`standard-roles.spec.ts` checks the exact four keys/labels, frozen metadata,
non-privileged flags, intentionally empty bundles, unique tenant-qualified stable
IDs, input rejection and sanitized conflict diagnostics. Empty bundles are an
explicit security assertion; tests must not fill them with broader tenant grants.

`support/standard-roles.integration.ts` runs through the Task 1.11 disposable
database harness with a restricted NOBYPASSRLS, non-owner role. It covers explicit
provisioning, unchanged re-runs, simultaneous connections, separate tenants,
metadata/bundle reconciliation, custom/reserved-ID collisions and whole-batch
rollback, preservation of custom grants/assignments, generic system-role guards,
all four relationship states and no automatic membership upgrade. Repository and
raw composite-FK probes reject cross-tenant assignments; missing/mismatched scope
cannot provision. Permission drift removal affects the next evaluation.

Fixture-owner access is limited to setup/corruption fixtures and migration
administration; protected behavior is exercised and asserted through restricted
tenant transactions. The existing 0000–0006 migration chain is applied to clean
disposable databases and repeated without changing provisioned roles. There is no
Task 1.13 migration. Better Auth-owned schema comparison remains unchanged.

## Task 1.14 church verification tests

`church-verification.spec.ts` covers all five states, invalid input, all 25 state
pairs (six permitted, fourteen forbidden, five unchanged), request/review action
classification, ordinary-details protected-field rejection and the narrow internal
service/repository surface. ChurchModule remains unmounted with no controllers.

`support/church-verification.integration.ts` uses the Task 1.11 disposable tenant
harness and restricted NOBYPASSRLS/non-owner connections. It tests defaults, scoped
request transitions, timestamp/no-op behavior, status independence, rejection and
revocation retries, known foreign IDs, missing/mismatched scope, rollback and pooled
context cleanup. Two actual database connections synchronize before concurrent
operations: duplicate requests produce one changed/one unchanged result, while
competing review compare-and-set probes produce one changed/one stale result.

Review SQL exists only as a test primitive, explicitly scoped and run through the
restricted transaction boundary. It tests the domain policy and PostgreSQL atomic
update behavior; it is not a production platform review service or authorization
proof. Global session/2FA-state preservation observations receive only explicit
column-level SELECT grants in the disposable fixture. No auth write permission or
production grant is added. Tenant assertions remain under the restricted runtime.
Verification preserves memberships, roles, grants, assignments and global session/
2FA state; it does not broaden effective permissions or tenant visibility.

The unchanged 0000–0006 migration chain is applied cleanly and repeated, preserving
verification state and seven journal entries. All prior church, membership,
authorization, standard-role and authentication suites remain required. Pinned
Better Auth 1.7.4 schema generation must remain identical. No Task 1.14 migration.

## Task 1.15 assurance regression coverage

Historical baseline: login/issuance gate statements here are superseded by Task 1.7b-2 below.

`assurance.spec.ts` covers normal versus elevated versus recent proof, exact
15-minute/eight-hour/five-minute boundaries, invalid/future/pre-session timestamps,
clock failure, immutable permission requirements, proof independence and the fixed
closed issuance gate. Test-only sensitive permission definitions exercise requirement
mechanics without registering a real privileged capability.

`support/assurance.integration.ts` uses disposable PostgreSQL and the production
AuthModule. Only its isolated fixture can insert assurance. Tests cover clean/repeat
0000–0007 migrations, PK/FK/cascade, same-user different-session and cross-user
binding, expiry, activity, concurrent refresh/invalidation and no resurrection.
Real logout, password reset/change, email change, factor-disable rotation, deletion
failure and client-field/endpoint tests exercise the lifecycle. Backup regeneration
in the existing isolated factor fixture creates no assurance. Proof and session
secrets are never assertion snapshots. There is no native verifier added to production.

`support/assurance-authorization.integration.ts` uses the restricted tenant harness,
with only explicit non-secret session-column/assurance SELECT grants in its disposable
role. It verifies tenant/user isolation, inactive/member/left transitions, follower
denial and immediate permission/assignment loss despite stored assurance. Existing
RLS and auth regressions remain mandatory. Prior migration-count assertions now
include the eighth migration; Better Auth-owned schema comparison remains unchanged.

Run the canonical contracts/API/client/Flutter/Playwright checks and `pnpm db:check`.
Task 1.15 validates storage/policy, not secure MFA completion: Task 1.7b remains blocked.

## Task 1.7b-1 enrollment consistency tests

Historical baseline: login/issuance gate statements here are superseded by Task 1.7b-2 below.

`enrollment.spec.ts` covers generation references, ciphertext fingerprinting,
ownership, exact expiry boundaries, strict input/secret-safe diagnostics and the
unchanged login/elevation gates. `support/enrollment.integration.ts` exercises the
real application endpoints in a disposable PostgreSQL database. Native Better Auth
is used separately only to generate fixture codes, never to bypass confirmation.

Permanent races queue operations behind a PostgreSQL user-row lock, using separate
auth instances: confirmation-first rejects replacement and preserves the verified
material; replacement-first rejects old confirmation and requires the new setup's
proof. Duplicate confirmation transitions once. Tests also cover password/origin/
identity restrictions, expiry, cross-user isolation, no-store, unchanged session
count and absolute age, zero assurance, and transactional rollback of native factor,
user flag, session rotation and generation state on forced persistence failures.
No replacement cookie may escape a failed transaction.

Clean migration coverage includes 0000–0008; repeat migration preserves pending
material and user deletion cascades coordination. Better Auth 1.7.4 generation must
still reproduce its committed schema exactly; the enrollment table is application-
owned and must not appear in that generator output. The original #10387 probe is
retained unchanged. This subtask does not activate TOTP/recovery login, privileged
assurance or a custom replay guard.

Task 1.7b-1 validation: 25 new fast tests (357 total) and 19 new PostgreSQL tests
(436 total), including authenticated confirmation throttling and a session revoked
while waiting for the user lock. Contracts (2), web (1), admin (1), Flutter (1) and
Playwright (3) pass, alongside typechecks/builds, formatting, Drizzle check,
clean/repeated migration and the identical pinned Better Auth schema comparison.

## Task 1.7b-2 — factor login and assurance proof regressions

The earlier closed-gate expectations describe their original task baselines; the
current suite expects native challenge completion while preserving all prior test
blocks and enrollment race/rollback assertions. `factor-verification.spec.ts` adds
21 fast cases for strict code-only input, secret-safe errors and canonical versus
server-only endpoint boundaries. The API total is 378 fast tests.

`support/factor-login.integration.ts` adds 28 PostgreSQL cases using real enrollment,
canonical login challenges and internal native proof operations. Coverage includes
wrong/malformed/expired codes; no pre-factor session; consumed-challenge sequential
and concurrent rejection; independent-challenge replay characterization; recovery
sequential/concurrent one-use and cross-user isolation; challenge expiry/attempt
budget; trusted-device and injected-claim rejection; no native enrollment bypass;
secret-safe logs/responses; session-bound explicit elevation and independent step-up;
no HTTP issuer; expired-session denial; proof-persistence rollback with recovery
consumption; revocation/logout, reset, factor disable and email-change interactions.
Ordinary factor login and enrollment must never issue assurance.

The PostgreSQL total is 464 tests. All 19 enrollment-consistency cases remain,
including confirmation-first/replacement-first ordering and native-write rollback.
Existing restricted-tenant authorization and exact 15m/8h/5m boundary tests remain.
Clean/repeated migration tests use the unchanged 0000–0008 chain. Pinned Better Auth
1.7.4 schema generation must still match the committed Better Auth-owned schema.

Both the original isolated native probe and the public challenge regression carry
`KNOWN UPSTREAM LIMITATION — better-auth/better-auth#10387`. They characterize
accepted cross-challenge reuse with passing assertions, not an invented rejection.
They must be revisited with sequential/concurrent independent challenges and
active-session proof replay before removing the exception after a released fix.

## Task 1.16 — ownership and mandatory audit regressions

`ownership.spec.ts` adds 23 fast cases for membership/factor eligibility, independent
assurance requirements, protected-field rejection, an unmounted module with no generic
removal/audit rewrite API, and preservation of the documented #10387 exception.

`support/ownership.integration.ts` adds 54 PostgreSQL tests through the Task 1.11
restricted non-owner/NOBYPASSRLS harness. Setup may create structural auth/assurance
fixtures using the migration connection, but every asserted ownership/RLS operation
runs through restricted runtime transactions. Only explicit non-secret auth columns
and ID-column UPDATE privileges needed for row locking are granted; no secret-column
read or production role/bypass is added. Native factor/session issuance continues to
be exercised by the full unchanged authentication suites.

Coverage includes first/second/concurrent establishment; current member and verified
factor eligibility for both actor/recipient; actor/session binding; atomic transfer;
self/stale/concurrent transfer and exact audit counts; initial/transfer audit-failure
rollback; missing/foreign/mismatched tenant scope; direct composite FK and PK rejection;
runtime audit UPDATE/DELETE denial; membership/user deletion preserving historical
audits; complete church cascade; exact assurance expiry boundaries; post-lock session
revocation/proof-expiry/recipient-status rechecks; immediate membership/factor authority
loss/restoration; and unchanged role/grant/session state. No public owner API exists.

The 0008-to-0009 upgrade regression preserves populated auth, factor, assurance,
church, membership and authorization tables. Clean and repeated migration tests cover
all ten migrations without backfilling owners. Existing migration-count assertions
advance to ten; prior security assertions remain. Pinned Better Auth schema generation
must remain identical and exclude both application-owned ownership tables.

Run frozen install, format, contracts/API checks, PostgreSQL tests, Drizzle check,
web/admin lint/typecheck/test/build, Playwright typecheck/E2E and Flutter validation.

## Task 1.17 — atomic onboarding regressions

`onboarding.spec.ts` checks the unmounted internal module, protected creator/owner
input rejection through existing church validation, canonical nonprivileged empty
role definitions, normalization and early fail-closed creator checks.
`support/onboarding.integration.ts` uses the Task 1.11 disposable PostgreSQL harness
with a non-owner/NOBYPASSRLS runtime. Non-secret auth SELECT and ID-column UPDATE
privileges support current session/factor row locks; test setup alone uses the
migration connection. Structural session/factor fixtures have no assurance row.
All existing native factor/login and ownership/transfer security suites remain.

Tests prove eligible onboarding without elevation/step-up, exact artifacts/defaults,
missing/pending/disabled factor rejection, session revocation/expiry/identity checks,
invalid/protected input, safe duplicate/canonical slug conflicts, concurrent same-slug
one-winner behavior and independent different-slug provisioning. Instrumented real
repository stages share the same transaction object, backend PID and transaction ID.

Database INSERT-trigger failures at church, membership, owner, audit and role stages
leave zero committed artifacts. Additional tests cover ownership denial and failure
after roles have actually been inserted. Cross-tenant and mismatched-context reads,
restricted-role checks, rejection of migration credentials, cleared pooled context,
session/factor/assurance preservation, safe result mapping, and clean/repeated
migrations through 0009 are permanent regressions. No migration 0010 is introduced.
Run full contracts/API/PostgreSQL/client/Flutter/Playwright checks, Drizzle validation
and the pinned Better Auth schema comparison before review.

## Task 1.18 — onboarding HTTP regressions

`onboarding-http.spec.ts` exercises the real Nest controller/guard/pipe with isolated
session/service doubles: server identity, statuses, exact Origin, strict protected/
invalid fields, query selectors, no-store, response filtering, throttling and absent
management routes. Sliding-hour boundaries and per-user limits are deterministic.

`support/onboarding-http.integration.ts` uses AppModule, real signup/verification and
real enrollment confirmation through the Task 1.11 disposable restricted-role harness.
Named account-table DML grants let AuthModule use the same non-owner/NOBYPASSRLS
runtime as onboarding. Privileged connections are only for setup/inspection and
migration/failure triggers. An isolated pinned native generator supplies test codes;
no factor flag or assurance is fabricated to authorize onboarding.

Tests cover exact artifacts/defaults, invalid sessions and factors, Origin/input
rejection, duplicate/concurrent same-slug one-winner behavior, per-user limits,
response privacy, unchanged sessions/assurance, owner predicate and post-creation
cross-tenant RLS. Real membership/owner/audit/role INSERT failures yield sanitized
503 and zero artifacts. Clean/repeated migration remains through 0009 and preserves
the HTTP-created result. All Task 1.17 rollback and prior auth/tenant tests remain.

Existing Playwright tests cover client shells/public health without authenticated
backend fixture setup. HTTP/PostgreSQL integration provides this task's end-to-end
backend coverage; no frontend onboarding UI or browser credential fixtures are added.
Run frozen install, format, contracts/API/PostgreSQL, Drizzle, pinned Better Auth
schema comparison, web/admin checks, Flutter and Playwright before review.

## Task 1.19 — Main Church Administrator regression coverage

Fast registry tests retain the four original empty/nonprivileged bundle assertions
and add the exact fifth privileged role and two canonical permission requirements.
Sessionless checks explicitly deny privileged keys. Unknown permissions remain denied.

`support/main-church-administrator.integration.ts` uses disposable PostgreSQL and
the restricted tenant runtime, with grants limited to non-secret factor/session
columns needed for evaluation. Fixture-only identity/factor/assurance setup is not a
production proof issuer. Cases cover exact bundles, missing/expired/session-mismatched
elevation, disabled/unverified/missing/ambiguous factors, membership transitions,
custom-role metadata inheritance, immediate grant removal, foreign tenant/session
isolation, absolute session expiry, owner separation, exact reconciliation,
concurrency, canonical collision rollback, mutation guards and explicit upgrades of
existing four-role churches without automatic assignments. Existing native factor
proof/disable, ownership, RLS and authentication tests remain required.

Provisioning/onboarding regressions must expect five roles, exactly two administrator
permission mappings and zero automatic assignments, retaining the original four empty
bundles and every downstream failure rollback check. Clean/repeated migrations remain
0000 through 0009; no new migration or Better Auth schema change belongs to this task.
Run all canonical repository checks, including clients, Flutter and Playwright, before
marking Task 1.19 ready for review. The permanent #10387 accepted-limitation probe remains.

## Task 1.20 — administration API and admin audit

`test/church-admin.spec.ts` covers strict canonical PATCH validation, protected fields,
pagination, explicit privacy-safe mapping and bounded mutation limiting.
`test/support/church-admin.integration.ts` exercises the mounted AppModule with real
Better Auth cookie resolution and disposable restricted PostgreSQL. Factor/assurance
fixtures remain test-process-only; no production proof issuer or bypass is introduced.

Coverage includes both permission gates, exact-session isolation, factor loss,
inactive/follower/left denial, exact 15-minute/eight-hour boundaries, custom roles,
no owner-only grant, foreign/nonexistent/locked-foreign scopes, strict Origin,
protected input, safe slug conflicts, concurrent partial updates, no-op semantics,
bounded member pagination, no private fields and absent mutation/assignment/owner APIs.
Reads and failures do not refresh assurance. Permission removal and elevation expiry
while waiting on a church lock are rechecked before mutation.

Audit tests verify settings/audit/activity atomicity, forced PostgreSQL audit failure,
activity-write failure, value-free field metadata, tenant/missing/mismatched RLS
contexts, restricted roles, append-only behavior and retention after actor deletion.
Migration 0010 adds only admin audit. Tests preserve pre-0010 auth, church, membership,
role/permission and owner/audit data on upgrade and repeat the runner without changes.
Existing total-history assertions advance from ten to eleven migrations; all prior
security assertions, five canonical onboarding roles and zero assignments remain.
Run the full contracts/API/PostgreSQL/web/admin/Flutter/Playwright suite, Drizzle check,
pinned Better Auth core-schema comparison, formatting and diff checks before review.

## Task 1.21a Google bridge regressions

google-pre-auth.spec.ts covers configuration, strict input, hashed credentials, production closure and native hook scope. support/google-pre-auth.integration.ts uses disposable PostgreSQL and deterministic Google doubles with external network forbidden. Native OAuth state/cookie verification remains active.

Permanent characterization: KNOWN UPSTREAM/NATIVE LIMITATION — Google social callback bypasses Better Auth two-factor enforcement in pinned 1.7.4. The isolated native instance demonstrates the bypass; bridge regressions require zero pre-factor sessions. This is separate from the unchanged accepted better-auth/better-auth#10387 probe.

Tests cover linked no-factor login/logout, same-email collisions, provider ambiguity, closed native/link/token routes, exact expiry, identity/factor invalidation, same-state replay, independent concurrent callbacks, concurrent single consumption, forced challenge-write failure and a session-insert rejection trigger. An independent connection observes committed pre-auth state but no session during callback processing. Profile, onboarding, tenant-member and admin-settings endpoints deny pre-auth, including with assurance on another session. Clean/repeated migrations remain through 0010. Public factor completion is not part of this task.


## Task 1.21b-0 — Authentication Security Event Foundation

Fast policy tests cover the exact closed registry, event-specific fields, strict
metadata and secret/unknown-field rejection, historical identifiers, and the
absence of read/update/delete or authentication authority in the writer.

PostgreSQL tests exercise migration 0011, upgrade from 0010, repeat migration and
preservation of prior data, insertion without tenant context, INSERT-only restricted
runtime grants, denied read/update/delete/truncate, SQL validation, historical
retention and a separate classified-failure transaction after authentication rollback.
Existing clean migration suites advance to twelve entries; all prior preservation,
RLS and auth-schema assertions remain and include only the approved new table/index.

Native integration tests prove audit failure rolls back password changes/resets,
reset-token consumption, session revocation, email identity/workflow mutation,
enrollment activation/session rotation, factor disable/assurance removal, and backup
regeneration. Recovery-based assurance proof tests show one success/one audit under
concurrency, no event for failure/replay, and recovery material preserved if audit
insertion fails. Tests compare secret-bearing values as booleans to avoid dumping
them. At the foundation stage ordinary recovery-login auditing was deferred under
the approved primitive allowance; Task 1.21e now wraps that mounted endpoint with
the shared atomic redemption boundary. No Google completion is implemented or
enabled by this task.

No repeated/suspicious incident threshold was inferred from native lockout settings.
The foundation tests use explicitly classified fixture events; Task 1.21d now adds
the production classifier/emitter policy without changing native counters. The
permanent native Google 2FA-bypass characterization and the distinct accepted
better-auth/better-auth#10387 replay probe remain required.

## Task 1.21b — Google completion regressions

`google-completion.spec.ts` tests strict challenge/code validation, HttpOnly-cookie
transport, contradictory credentials, rejected authority fields, bounded shared
attempt limiting, source-rule configuration and closed production/signup policy.
Mounted HTTP tests require no-store even for early native source-throttling responses.
The exact endpoint inventory test includes only the two approved completion routes.

`support/google-completion.integration.ts` uses the Task 1.11 disposable restricted
runtime, real native encrypted factors/verifiers, deterministic Google provider
stubs and no external network. The harness checks its disposable database name
before fixture mutation; audit history is not truncated. PostgreSQL tests cover
success/failure, same- and independent-challenge recovery concurrency, single-session
issuance, native failure budgets/lockout, exact expiry and lock waits, provider/factor/
deleted-user races, session/audit failure rollback, privacy, secure cookie completion,
AuthSessionReader, logout/current/other/all revocation and no tenant/assurance side
effects. Real elevation/step-up proofs on Google-completed sessions demonstrate
that another session's assurance cannot transfer and that admin/owner policies remain.

Test timestamps use UTC serialization consistent with Drizzle for Better Auth's
without-time-zone columns. Exact expiry assertions are retained; no time tolerance
is introduced into production policy. The suite retains the Task 1.21a native
Google bypass characterization (unaccepted) and the separate #10387 accepted replay
probe. Run all prior credential/factor/audit/tenant regressions, unchanged migration
chain through 0011 (clean/upgrade/repeat), pinned schema comparison, and the full
contracts/API/client/Flutter/Playwright validation before review.

## Task 1.21c — Google public activation boundary regressions

`google-pre-auth.spec.ts` and `google-public.spec.ts` cover the fixed callback and
completion destinations, rejection of absolute/protocol-relative/script/data and
encoded redirect values, the closed production gate and bounded source throttles.
The PostgreSQL HTTP suite additionally checks that `/api/v1/google/start` and
`/api/v1/google/callback` remain unavailable while the gate is false, while the
existing deterministic provider integration continues to exercise the bridge,
factor-required pre-auth isolation, no-factor opaque-session behavior, state replay,
same-email collision, provider identity binding, linking/token route closure and
protected-API denial.

The native Better Auth 1.7.4 Google/TOTP bypass characterization remains permanent
and explicitly unaccepted. The public tests never call Google or use credentials;
provider methods are deterministic stubs and external network is rejected. Missing,
invalid, tampered and replayed state are denied by the native callback path. The
fixed controller does not accept a return-to value, so open-redirect variants are
covered as policy tests. Initiation/callback limiter windows and bounded capacity
are deterministic. Since the production gate remains false, no test claims that
Google is publicly active; activation requires a separate review of every matrix
row, including the Task 1.21d classification policy.

## Task 1.21d — authentication failure classification regressions

`auth-failure-classifier.spec.ts` covers the five-failures-in-ten-minutes threshold,
strict `age < 10 minutes` expiry, ten-minute suppression, success reset, user/flow
isolation, concurrent threshold crossing, bounded 10,000-key capacity, target
normalization and writer-failure fail-closed behavior. The durable event remains the
closed existing `authentication_failure` registry entry; no target or secret is part
of its metadata.

Real PostgreSQL factor tests cover credential, native TOTP, native recovery and
Google-factor failures. They prove one event at threshold, no event for malformed
input, native lock/rate-limit behavior remains unchanged, and Google failure metadata
contains only the approved factor method/category. Existing auth-security-event tests
continue to prove the post-failure transaction boundary and restricted event table.
No repeated/suspicious threshold is inferred from native lockout counters, and no
authentication result depends on the availability of the failure-event writer.
The policy adds no migration; the pinned Better Auth schema and migration chain remain
unchanged. Google production activation remains disabled pending its complete matrix.

## Task 1.21e — atomic recovery-code redemption regressions

The recovery-login integration wraps the mounted Better Auth backup-code endpoint
with the application transaction boundary. Tests use real PostgreSQL connections
and verify the canonical encrypted representation remains valid while the user and
`two_factor` rows are locked and re-read before native verification. Coverage
includes sequential replay, two-way and ten-way independent-challenge races,
ordinary-login versus recovery-assurance cross-flow races, cross-user denial,
invalid proof, exactly one `recovery_code_used` event, and no duplicate session or
assurance state. Regeneration, factor-disable and user-deletion interactions are
serialized by the same stable lock order; stale codes cannot reappear.

Failure-injection tests force audit and session insertion errors after otherwise
valid proof. They require the transaction to roll back the code, event, session and
associated operation so the code remains safely usable. Conclusive native failure
accounting is allowed to commit without authentication success. A disposable
500-iteration PostgreSQL stress probe supplements deterministic tests and must
report zero double-success outcomes. The native Better Auth compare-and-swap race
remains documented as a fixed upstream defect, never as an accepted exception;
`better-auth/better-auth#10387` remains the separate accepted cross-challenge TOTP
limitation. All prior credential, TOTP, Google pre-auth/completion, assurance,
tenant and authentication-event regressions remain required.
