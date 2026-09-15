# Church Platform – Implementation Roadmap

## 1. Purpose

This document defines the implementation order for the Church Platform.

The platform contains many modules and must not be implemented all at once.

The roadmap exists to ensure that:

- foundational architecture is built first
- security boundaries exist before complex features depend on them
- multi-tenancy is proven early
- permissions are established before administration grows
- development remains reviewable
- Codex works in small, testable increments
- unnecessary rework is avoided

Codex must follow this roadmap unless the project owner explicitly changes priorities.

---

# 2. Roadmap Principles

Development should follow these principles:

1. Build foundations before features.
2. Security before convenience.
3. Multi-tenancy before tenant-specific modules.
4. Permissions before administration.
5. Testing infrastructure before large feature development.
6. Small vertical slices are preferred over unfinished broad scaffolding.
7. Every phase must remain deployable where practical.
8. Avoid implementing future phases early without a clear dependency.
9. Do not implement the entire product specification in one large change.
10. Finish and stabilize each foundation before building heavily on top of it.

---

# 3. Development Strategy

The project should be developed incrementally.

Preferred workflow:

```text
Foundation
    ↓
Small feature
    ↓
Tests
    ↓
Review
    ↓
Stabilize
    ↓
Next feature
```

Avoid:

```text
Build 20 modules partially
    ↓
Connect everything later
    ↓
Discover architecture problems
```

---

# 4. Phase 0 – Project Foundation

Before implementing product features, establish the development foundation.

Goals:

- repository structure
- development tooling
- local environment
- backend framework
- web framework
- Flutter project
- database
- migrations
- CI
- formatting
- linting
- testing infrastructure
- environment configuration

---

## 4.1 Phase 0 Deliverables

Expected deliverables include:

```text
apps/mobile/
apps/web/
apps/admin/
services/api/
packages/
infrastructure/
tests/
.github/workflows/
```

Set up:

- Flutter
- Next.js
- backend framework
- PostgreSQL
- Docker
- environment configuration
- dependency management
- basic CI

---

## 4.2 Backend Framework Selection

During Phase 0, select and document the backend framework.

Requirements:

- TypeScript
- modular architecture
- strong testing support
- validation
- PostgreSQL support
- background job support
- maintainability

The decision should be documented with an ADR.

Example:

```text
docs/adr/0001-backend-framework.md
```

Do not begin major backend implementation before this decision is documented.

---

## 4.3 Database Access Decision

Accepted: PostgreSQL with Drizzle ORM, `node-postgres`, and Drizzle Kit. See [ADR 0002](adr/0002-database-access.md) for reviewed migrations and transaction rules, and [ADR 0006](adr/0006-tenancy-and-authorization.md) for application authorization plus RLS.

Requirements:

- migrations
- transactions
- PostgreSQL support
- explicit tenant filtering
- testability
- safe schema evolution

Document the decision.

---

## 4.4 Authentication Architecture Decision

Accepted: Better Auth behind the application-owned NestJS AuthModule, PostgreSQL-backed opaque sessions, TOTP, and explicit assurance/step-up policy. See [ADR 0003](adr/0003-authentication-and-sessions.md).

Must support:

- email/password
- Google
- Apple
- email verification
- session management
- 2FA
- multiple devices
- session revocation

Do not choose an authentication solution that prevents required security behavior.

---

## 4.5 Phase 0 Exit Criteria

Storage and realtime architecture are accepted in [ADR 0004](adr/0004-object-storage.md) and [ADR 0005](adr/0005-realtime.md). Record these decisions now; implement the S3 abstraction/local service only when storage behavior is needed and Socket.IO gateways only with a justified realtime feature. Garage is the preferred local storage candidate subject to compatibility; neither realtime nor its Redis adapter is a minimum Phase 0 runtime requirement.

Phase 0 is complete when:

- repository structure exists
- backend starts locally
- web app starts locally
- Flutter app starts locally
- PostgreSQL works locally
- migrations work
- tests can run
- CI exists
- formatting/linting checks work
- environment secrets are excluded from Git
- basic documentation is updated

No substantial product module should be implemented before these foundations are stable.

---

# 5. Phase 1 – Identity, Tenancy and Authorization

Phase 1 builds the security foundation of the entire platform.

This is the most important development phase.

Goals:

- authentication
- users
- profiles
- churches/tenants
- memberships
- roles
- permissions
- tenant isolation
- church onboarding
- ownership
- base administration

---

# 6. Phase 1A – User Authentication

Implement:

- account registration
- email verification
- login
- logout
- password reset
- session management
- active session list
- revoke session
- revoke other sessions

Then add:

- Google authentication
- Apple authentication

Do not expose production social-login credentials in the repository.

Follow ADR 0003 for secure explicit linking, social-only accounts without local passwords, web/mobile session lifetimes, and password-reset revocation of all sessions. Verify supported integration behavior before exposing each flow. Establish the TOTP/recovery and assurance/step-up foundation described in Phase 1L before enabling any privileged role, ownership, or administrative functionality; social login must pass the same assurance gates.

---

## 6.1 Authentication Tests

Before continuing, test:

- valid login
- invalid login
- email verification
- password reset
- expired reset token
- revoked session
- session expiration

Security tests must be part of CI.

---

# 7. Phase 1B – User Profile

Task 1.8 — User Profile Backend Foundation maps to Phase 1B. Its backend scope
is authenticated self-profile only, using an application-owned one-to-one
user_profile table and the canonical Better Auth user.image reference.
Public/member directories, visibility controls and client UI remain deferred.

Task 1.7a and Task 1.7b-1 are complete. Task 1.7b-2 activates native factor login
and internal assurance proof under the explicitly accepted temporary replay risk
tracked by better-auth/better-auth#10387. Task 1.7 is complete with that exception,
Task 1.7b-2 is reviewed and complete. See the current acceptance section at the end.
No privileged capability may bypass the TOTP/assurance prerequisites in Phase 1L.

Implement the platform user profile.

Initial fields:

- username
- profile picture
- first name
- last name
- date of birth
- phone number
- address
- biography

Implement privacy-aware API responses from the beginning.

Do not expose all profile fields automatically.

---

# 8. Phase 1C – Church/Tenant Model

Task 1.9 — Church/Tenant Model & Isolation Foundation maps to Phase 1C.
This internal foundation includes trusted context, explicit scoping and restricted-role
RLS tests. Memberships, ownership, administration and public endpoints remain deferred;
Task 1.7 remains blocked and privileged capabilities remain unavailable.

Implement the church tenant model.

One church equals one tenant.

Initial church fields may include:

- ID
- name
- slug
- address
- denomination
- logo
- status
- verification state
- created time

Every tenant-owned resource must have a clear tenant relationship.

Introduce explicit repository scoping, transaction-local RLS, ownership constraints, and release-blocking isolation tests with the first tenant-owned tables/services. Do not wait for Phase 1E to prove these boundaries.

---

# 9. Phase 1D – Tenant Membership

Task 1.10 — Tenant Membership Foundation maps to Phase 1D. It adds the internal
tenant-scoped relationship model, constraints and restricted-role RLS tests.
Membership workflows, follow/unfollow, directory, roles/permissions, Primary Owner
and HTTP APIs remain deferred. Task 1.7 remains BLOCKED; no TOTP workaround exists.

Implement relationships between users and churches.

Base states:

- Follower
- Member
- Inactive
- Left Church

A user may belong to multiple churches.

Membership state must always be scoped to one tenant.

---

# 10. Phase 1E – Tenant Isolation Test Harness

Task 1.11 — Reusable Tenant Isolation Test Harness maps to Phase 1E.
It standardizes the existing church/membership PostgreSQL isolation fixtures and
release-blocking tests without adding product behavior. Task 1.7 remains blocked.

Extend the isolation tests introduced with the first tenant-owned tables into reusable helpers for all later tenant modules.

Create common test fixtures:

```text
Tenant A
Tenant B
User A
User B
Admin A
Admin B
```

The project should make it easy to test:

```text
Tenant A user → Tenant A resource → allowed
Tenant A user → Tenant B resource → denied
```

This infrastructure should be reused by all later modules.

---

# 11. Phase 1F – Roles and Permissions

Implement the permission system defined in:

`docs/PERMISSIONS.md`

Core concepts:

- permissions
- standard roles
- custom roles
- role assignments
- object-scoped permissions
- tenant-scoped permissions

Avoid scattered role-name checks.

Use centralized authorization logic.

---

# 12. Phase 1G – Standard Roles

Initial standard roles should include:

- Group Leader
- Area Leader
- Event Administrator
- Children’s Worker
- Main Church Administrator
- Primary Owner

Platform Superadmin remains platform-scoped.

Member is a relationship state with derived capabilities, not an assignable administrative role. Primary Owner is a protected ownership relationship/capability.

---

# 13. Phase 1H – Primary Owner

Implement exactly one Primary Owner per church.

Required rules:

- one owner only
- owner protected from normal administrators
- ownership transfer controlled
- transfer transactional
- audit event generated
- mandatory 2FA and recent step-up authentication before ownership transfer is enabled

---

# 14. Phase 1I – Church Onboarding

Implement basic church creation.

Onboarding should collect:

- name
- address
- denomination
- logo
- service times
- public visibility

Create the first Primary Owner during church creation.

The receiving account must satisfy mandatory verified 2FA prerequisites before activating ownership. Do not create an unprotected owner as a temporary onboarding shortcut.

---

# 15. Phase 1J – Church Verification Foundation

Implement verification state.

Suggested states:

- unverified
- pending
- verified
- rejected
- revoked

Detailed superadmin verification workflows may be expanded later.

---

# 16. Phase 1K – Base Church Administration

Create the initial church administration shell.

Possible initial modules:

- church profile
- members
- roles
- settings

Only authorized users may see administration navigation.

Do not build all administration modules yet.

---

# 17. Phase 1L – 2FA

This is a prerequisite for privileged functionality, not a later hardening step: implement the TOTP/recovery, elevation, and step-up foundation alongside authentication, before enabling Phase 1G privileged roles, Phase 1H ownership, Phase 1I owner creation, or Phase 1K administration. Section numbering does not override this dependency.

Mandatory for:

- Primary Owner
- Main Church Administrator
- Platform Superadmin

Initially support TOTP.

Include recovery codes.

Apply mandatory 2FA by effective capability, including custom roles, and test Google/Apple cannot bypass it. Use the normal-session, elevation, and five-minute step-up policies in ADR 0003. Factor-disable/recovery and privilege transitions must be safe before these capabilities are enabled.

---

# 18. Phase 1 Exit Criteria

Phase 1 is complete only when:

- authentication works
- sessions work
- users exist
- churches exist
- user can belong to multiple churches
- tenant isolation is proven
- roles work
- permissions work
- Primary Owner rules work
- base onboarding works
- base administration works
- mandatory authorization tests exist
- tenant isolation tests pass
- security-critical flows are covered

Do not proceed to rapid feature growth if tenant isolation is unstable.

---

# 19. Phase 2 – Church Presence and Membership

Phase 2 focuses on church discovery and growing church relationships.

Goals:

- public church page
- church discovery
- followers
- membership requests
- member administration
- member directory
- organizational areas

---

# 20. Phase 2A – Public Church Page

Implement public church pages.

Initial blocks:

- About
- Service Times
- Events placeholder/integration
- Sermons placeholder/integration
- Help placeholder/integration
- Contact

Allow:

- logo
- hero image
- accent color
- block activation
- block ordering

Do not implement a free-form website builder.

---

# 21. Phase 2B – Public Slugs and SEO

Implement:

- unique church slug
- reserved slug validation
- public metadata
- search engine indexing where allowed

Only public data may be indexed.

---

# 22. Phase 2C – Church Discovery

Implement church search.

Initial search:

- name
- city
- postal code

Then add:

- distance
- denomination
- languages
- selected attributes

Map view may be added after basic discovery works.

---

# 23. Phase 2D – Followers

Implement:

- follow church
- unfollow church
- church follower list
- remove follower
- block follower

Do not build complex CRM functionality.

---

# 24. Phase 2E – Membership Requests

Implement:

- request membership
- required profile fields
- custom questions
- administrator review
- acceptance
- rejection

Follower-to-member transition must reuse the existing relationship.

Do not create duplicate users or duplicate person relationships.

---

# 25. Phase 2F – Member Administration

Implement:

- member list
- member search
- membership status
- internal fields
- custom fields
- administrative notes
- member detail page

Privacy filtering must already be active.

---

# 26. Phase 2G – Member Directory

Create member-facing directory.

Default visibility should remain privacy-aware.

Do not reuse unrestricted administrative member responses for normal members.

---

# 27. Phase 2H – Areas and Ministries

Implement flexible church areas.

Examples:

- children
- youth
- music
- technology
- pastoral care
- administration
- mission

Support:

- members
- leaders
- skills

---

# 28. Phase 2 Exit Criteria

Phase 2 is complete when:

- public church page works
- discovery works
- follow/unfollow works
- membership requests work
- membership administration works
- directory respects privacy
- areas exist
- cross-tenant tests pass for all new modules

---

# 29. Phase 3 – Content, Calendar and Events

Phase 3 introduces the main day-to-day church experience.

Goals:

- feed
- important messages
- notifications
- calendar
- events
- registrations
- waitlists
- check-in

---

# 30. Phase 3A – Feed

Implement:

- posts
- text
- images
- audience targeting
- comments
- reactions
- save
- pinning
- scheduled publishing
- expiry

Do not build advanced recommendation algorithms in V1.

---

# 31. Phase 3B – Important Messages

Implement:

- important announcement
- push option
- confirmation required
- recipient state
- reminder after 24 hours
- optional email fallback

Ensure recipient authorization.

---

# 32. Phase 3C – Notification System

Build centralized notification infrastructure.

Support:

- in-app
- push
- email

Implement personal notification defaults and church-specific overrides.

Security notifications remain mandatory.

---

# 33. Phase 3D – Calendar

Implement personal aggregated calendar.

Sources:

- church events
- groups
- duties
- registrations

Add calendar layers.

Child calendar sources/layers are deferred until the child/guardian/sensitive-access foundation in Phase 6 exists.

External calendar integration may follow once the internal calendar is stable.

---

# 34. Phase 3E – Events

Implement:

- events
- recurring events
- audience
- custom registration fields
- registration deadline
- capacity
- age restrictions

---

# 35. Phase 3F – Event Templates

Implement:

- platform event templates
- church templates
- concrete event copies

Template changes must not unexpectedly alter existing events.

---

# 36. Phase 3G – Registration

Implement:

- personal registration
- guest registration
- cancellation

Child registration is deferred until the Phase 6 child/guardian/sensitive-access foundation exists; generic guest fields must not bypass this dependency.

Known account information should be prefilled appropriately.

---

# 37. Phase 3H – Waitlist

Implement:

- optional waitlist
- ordering
- automatic advancement
- notifications

Use safe concurrency control.

---

# 38. Phase 3I – Event Pricing

Implement price categories and external payment tracking.

Example states:

- open
- paid
- waived
- cancelled

Do not implement in-app payment processing.

---

# 39. Phase 3J – Event Administrators

Implement event-scoped administration.

Event administrator permissions must be limited to assigned events.

---

# 40. Phase 3K – Check-In

Implement:

- manual check-in
- QR check-in
- registered
- checked in
- cancelled
- no-show

Child-specific check-in and checkout are deferred to Phase 6 after the child/guardian/sensitive-access foundation exists.

---

# 41. Phase 3 Exit Criteria

Phase 3 is complete when:

- feed works
- announcements work
- notifications work
- calendar works
- events work
- registrations work
- waitlists are concurrency-safe
- event administration is object-scoped
- check-in works
- tenant and permission tests pass

---

# 42. Phase 4 – Groups, Communication and Spiritual Content

Goals:

- groups
- group content
- chat
- prayer
- Bible
- sermons
- learning materials

---

# 43. Phase 4A – Groups

Implement:

- group creation
- group types
- visibility
- membership
- join requests
- invitation-only groups
- group leaders
- participant limit
- optional waitlist

---

# 44. Phase 4B – Group Content

Add:

- announcements
- group events
- files
- basic learning content
- prayer integration

Keep permissions simple and context-based.

---

# 45. Phase 4C – Direct Messaging

Implement private direct messaging between accepted contacts.

Support initially:

- text
- replies
- reactions
- read state

Then add:

- images
- files
- voice messages

Do not build audio/video calling.

---

# 46. Phase 4D – Group Chat

Implement group chat based on valid group access.

Membership changes must affect access.

Do not expose group messages outside the group.

---

# 47. Phase 4E – Prayer

Implement protected prayer requests.

Audiences:

- private
- friends
- group
- church

Add:

- expiry
- prayer updates
- answered status
- “I am praying”

Prayer requests are never globally public.

---

# 48. Phase 4F – Bible

Implement personal Bible functionality.

Initial capabilities:

- Bible reading
- verse favorites
- highlights
- private notes

Only legally usable translations should be integrated.

No AI functionality.

---

# 49. Phase 4G – Sermons

Enforce the separate logical sermon-audio quota under ADR 0004 when audio uploads are introduced; do not defer upload quota enforcement until Phase 6 storage-administration UI.

Implement sermon library.

Support:

- YouTube links
- audio uploads
- sermon metadata
- preacher
- Bible passage
- series
- topics
- attachments
- favorites

Do not implement direct video file hosting.

---

# 50. Phase 4H – Bible Study Content

Implement church/group Bible study material.

Support:

- Bible passage
- teaching text
- questions
- quizzes
- notes
- group customization

Use template inheritance:

```text
Platform
→ Church
→ Group Lesson
```

---

# 51. Phase 4 Exit Criteria

Phase 4 is complete when:

- groups work
- group permissions work
- private chat works
- chat privacy tests pass
- prayer privacy works
- Bible notes remain private
- sermons work
- group learning content works

---

# 52. Phase 5 – Duties and Volunteer Coordination

Phase 5 implements the advanced service planning system.

Goals:

- duties
- skills
- availability
- assignment
- replacement
- automated rule-based planning
- planning analytics
- help/needs

---

# 53. Phase 5A – Duty Model

Implement:

- service areas
- duties
- event duties
- reusable duty templates
- duty states

Suggested states:

- open
- requested
- accepted
- declined
- replacement requested

---

# 54. Phase 5B – Skills

Implement:

- member-declared skills
- leader confirmation
- area-specific skills

Do not automatically consider unconfirmed skills for protected assignments where confirmation is required.

---

# 55. Phase 5C – Availability

Implement:

- unavailable from
- unavailable to
- optional reason

Recurring absences are not part of V1.

---

# 56. Phase 5D – Desired Frequency

Implement user preference for approximate serving frequency.

Treat this as guidance, not a strict rule.

---

# 57. Phase 5E – Duty Requests

Implement:

- assign person
- request person
- open duty
- accept
- decline
- replacement request

---

# 58. Phase 5F – Cross-Church Conflict Detection

Because users may belong to multiple churches, check relevant duty conflicts across churches.

Do not reveal unnecessary private information from another church.

The planner needs the conflict, not unrelated tenant data.

---

# 59. Phase 5G – Fairness Indicators

Implement planning hints.

Examples:

- recent service count
- future assignments
- absence
- desired frequency
- conflicts

Avoid judgmental scoring.

---

# 60. Phase 5H – Rule-Based Automatic Planning

Implement after manual planning is stable.

The algorithm considers:

- skills
- availability
- conflicts
- frequency
- recent workload

The result must always be a draft.

Never publish assignments automatically.

---

# 61. Phase 5I – Duty Analytics

Implement respectful planning analytics.

Examples:

- fill rate
- open duties
- recurring shortages
- members without service area
- recent service participation

---

# 62. Phase 5J – Needs and Help

Implement:

- goods needed
- quantities
- helpers needed
- commitments
- progress indicator

A user must be registered to commit help.

---

# 63. Phase 5 Exit Criteria

Phase 5 is complete when:

- manual duty planning is stable
- permissions work by area
- conflicts work
- rule-based planning produces drafts
- no automatic publishing exists
- analytics work
- needs/help works
- all tenant tests pass

---

# 64. Phase 6 – Children, Sensitive Data, Files and Data Portability

Phase 6 focuses on highly sensitive data and operational maturity.

Goals:

- child profiles
- guardian relationships
- medical data
- pickup permissions
- child check-in/out
- storage administration
- imports
- exports

---

# 65. Phase 6A – Child Profiles

Implement managed child profiles.

Fields may include:

- name
- date of birth
- emergency contact
- allergies
- medical notes
- pickup authorization

This phase requires strict security review.

---

# 66. Phase 6B – Guardians

Implement explicit parent/guardian relationships.

Do not infer relationships from name or address.

Support multiple guardians.

---

# 67. Phase 6C – Sensitive Child Access

Implement contextual authorization.

Examples:

- parent
- assigned worker
- event staff

Highly sensitive access should be logged where required.

---

# 68. Phase 6D – Child Check-In and Checkout

With Phases 6A–6C established, add the deferred child registration and authorized child calendar behavior before child check-in/out.

Extend event check-in with:

- child checked in
- child picked up
- pickup authorization
- optional strict checkout confirmation

---

# 69. Phase 6E – Child to Independent Account Conversion

Implement controlled conversion from managed child profile to independent account.

Preserve valid historical relationships.

Do not create duplicate person identity unnecessarily.

---

# 70. Phase 6F – File Storage Administration

Implement:

- storage usage
- storage categories
- quotas
- large file views
- deletion warnings
- sermon media quota

---

# 71. Phase 6G – CSV/Excel Import

Implement safe imports.

Initial focus:

- members
- groups
- areas

Use:

- preview
- validation
- error reporting
- tenant scoping

Do not immediately insert unvalidated large imports.

---

# 72. Phase 6H – Export

Implement:

- member export
- event export
- group export
- church-wide export foundation

Sensitive exports require explicit permissions and audit events.

---

# 73. Phase 6I – ChurchTools Import

Only begin after supported ChurchTools export formats have been analyzed.

Do not build against assumed undocumented formats.

The importer should translate source data into the Church Platform's own domain model.

---

# 74. Phase 6 Exit Criteria

Phase 6 is complete when:

- child profiles work securely
- guardian authorization works
- medical information is protected
- sensitive access tests pass
- child check-out works
- storage administration works
- imports are validated
- exports are secure
- cross-tenant import/export leakage is tested

---

# 75. Phase 7 – SaaS, Superadmin and Production Readiness

Phase 7 prepares the platform for broader production use.

Goals:

- SaaS plans
- quotas
- superadmin completion
- verification tooling
- platform templates
- widgets
- production hardening
- scaling
- operational readiness

---

# 76. Phase 7A – SaaS Plans

Implement:

- Free
- Basic
- Pro

Initially use fixed monthly church plans.

Architecture may support later member-based pricing.

No in-app payment processing is required initially.

---

# 77. Phase 7B – Feature Entitlements

Plans may affect:

- storage
- media storage
- premium modules
- selected advanced features

Entitlement checks must happen server-side.

Do not rely only on hidden UI.

---

# 78. Phase 7C – Superadmin Backend

Complete superadmin capabilities.

Examples:

- churches
- verification
- plans
- support
- global templates
- audits
- platform configuration

Maintain private-content restrictions.

---

# 79. Phase 7D – Church Verification Workflow

Complete the verification process.

Support:

- pending review
- evidence
- approval
- rejection
- revocation

All important verification actions require audit logging.

---

# 80. Phase 7E – Platform Templates

Implement global templates for:

- events
- Bible studies
- other approved reusable content

Churches may derive their own templates.

---

# 81. Phase 7F – Public Website Widgets

Implement initial embeddable widgets.

Examples:

- next service
- upcoming events
- sermons

Do not create a general-purpose public API yet.

---

# 82. Phase 7G – Account Deletion

Implement full account deletion lifecycle.

Product requirement:

3-month transition period.

Include:

- request
- scheduled processing
- anonymization/deletion
- cancellation if supported
- audit events

---

# 83. Phase 7H – Church Deletion

Implement full church deletion process.

Product requirement:

30-day protection period.

Require:

- authorization
- step-up authentication
- export opportunity
- scheduled deletion
- audit trail

---

# 84. Phase 7I – Backup and Recovery

Before broad production use:

- automate PostgreSQL backups
- protect backups
- define object storage backup/redundancy
- test restoration
- document recovery process

A backup process without tested restoration is incomplete.

---

# 85. Phase 7J – Monitoring

Implement production monitoring.

Include:

- uptime
- API health
- worker health
- database health
- errors
- failed jobs
- relevant performance metrics

---

# 86. Phase 7K – Security Hardening

Perform dedicated production security review.

Cover:

- authentication
- sessions
- 2FA
- tenant isolation
- permission escalation
- child data
- private messages
- prayer privacy
- uploads
- exports
- secrets
- CI/CD
- backups
- rate limiting
- dependency vulnerabilities

---

# 87. Phase 7L – Performance Review

Review realistic performance.

Focus on:

- member directory
- feed
- calendar
- duty planning
- events
- search
- large churches

Add indexes and optimizations based on measurement.

Do not optimize blindly.

---

# 88. Phase 7M – Accessibility Review

Perform final accessibility review of critical workflows.

Examples:

- registration
- login
- church search
- event registration
- navigation
- forms
- administration

---

# 89. Phase 7 Exit Criteria

Production readiness requires:

- major product flows stable
- CI passing
- tenant isolation proven
- security review completed
- 2FA enforced where required
- backups working
- restore tested
- monitoring active
- deletion workflows exist
- privacy-sensitive modules reviewed
- staging environment validated
- production deployment process documented

---

# 90. Features Explicitly Deferred Beyond V1

Do not implement the following unless the product owner explicitly reprioritizes them:

- AI sermon summarization
- AI sermon transcription
- AI Bible features
- AI duty scheduling
- direct video uploads
- in-app payments
- donation campaigns
- coupon systems
- personal donation history
- passkeys
- audio calls
- video calls
- recurring absence patterns
- personal project management
- recurring personal tasks
- appointment booking
- automatic translation of church-created content
- general-purpose public API
- campus hierarchy
- branch hierarchy

---

# 91. Possible Post-V1 Areas

The architecture may support future development of:

- church networks
- associations
- federations
- advanced reporting
- richer website integrations
- optional APIs
- advanced media
- additional authentication methods
- advanced support tooling
- stronger private messaging encryption
- advanced scheduling
- broader data integrations

These are not current implementation requirements.

---

# 92. Phase Dependency Rule

Later phases may depend on earlier phases.

Examples:

Events depend on:

```text
Users
→ Churches
→ Membership
→ Permissions
```

Duty planning depends on:

```text
Events
→ Areas
→ Members
→ Skills
→ Permissions
```

Child event management depends on:

```text
Events
→ Child Profiles
→ Guardians
→ Sensitive Permissions
```

Do not bypass foundation dependencies with temporary insecure shortcuts.

---

# 93. Vertical Slice Rule

Within each phase, prefer complete vertical slices.

Example for events:

Good:

```text
Create event
→ API
→ Database
→ Authorization
→ Web UI
→ Tests
```

before implementing ten incomplete event subfeatures.

Avoid:

```text
create 30 database tables
then later implement behavior
```

without need.

---

# 94. Small Pull Requests

Prefer focused changes.

Examples:

Good:

```text
Implement church creation API with tenant tests
```

Good:

```text
Add role assignment with privilege escalation tests
```

Poor:

```text
Implement complete Phase 1
```

as one giant change.

---

# 95. Feature Completion Rule

A feature should normally be completed before moving deeply into unrelated functionality.

Completion includes:

- backend
- authorization
- database
- API validation
- tests
- required UI
- error states
- documentation updates

---

# 96. No Premature Infrastructure

Do not introduce infrastructure before there is a demonstrated need.

Examples to avoid early:

- Kubernetes
- Elasticsearch/OpenSearch
- Kafka
- multiple databases
- many microservices
- large orchestration systems

Use the architecture defined in:

`docs/ARCHITECTURE.md`

---

# 97. No Premature Native Divergence

Keep Flutter as the shared mobile implementation.

Do not independently build:

- Android-specific product implementation
- iOS-specific product implementation

unless a platform-specific capability requires it.

---

# 98. Documentation During Development

Documentation must evolve with implementation.

When behavior changes, update:

- PRODUCT.md if product behavior changes
- ARCHITECTURE.md if technical architecture changes
- SECURITY.md if security requirements change
- PERMISSIONS.md if authorization changes
- TESTING.md if quality expectations change
- ROADMAP.md if implementation order changes

Do not allow documentation to become knowingly obsolete.

---

# 99. Architecture Decisions

Create ADRs for significant technical choices.

Possible early ADRs:

```text
0001-backend-framework.md
0002-database-access.md
0003-authentication-and-sessions.md
0004-object-storage.md
0005-realtime.md
0006-tenancy-and-authorization.md
```

ADRs should record:

- context
- decision
- alternatives
- consequences

---

# 100. Codex Roadmap Rule

Before implementing a feature, Codex must identify:

- current roadmap phase
- relevant module
- dependencies
- product requirements
- security requirements
- permissions
- tests

Codex must not begin unrelated future-phase work simply because it appears convenient.

---

# 101. When Codex May Cross Phase Boundaries

A small later-phase component may be implemented early only when it is a genuine technical dependency.

Example:

A basic notification abstraction may be needed before full notification functionality exists.

In such cases:

- implement only the necessary foundation
- do not expand into the full future feature
- document why the dependency was needed

---

# 102. Project Owner Override

The roadmap is authoritative by default.

The project owner may explicitly change priorities.

When this happens:

1. identify the requested change
2. identify affected dependencies
3. identify security consequences
4. update this roadmap if the change is permanent
5. proceed with the revised priority

---

# 103. Initial Implementation Order

The recommended immediate development sequence after documentation is complete is:

```text
1. Read-only Codex architecture review
2. Backend framework decision
3. Database access decision
4. Authentication decision
5. Monorepo scaffolding
6. Local Docker development environment
7. PostgreSQL + migrations
8. Testing infrastructure
9. GitHub Actions CI
10. Backend health endpoint
11. Web application shell
12. Flutter application shell
13. Authentication foundation, including TOTP/recovery and assurance/step-up before privileged functionality
14. User model
15. Church/tenant model
16. Tenant isolation test harness
17. Membership model
18. Permission system
19. Primary Owner
20. Church onboarding
```

Do not skip directly to visible product modules such as Feed or Chat before the security foundation exists.

---

# 104. First Codex Task After Documentation

The first Codex task after this documentation set is complete should be read-only.

Codex should:

1. read `AGENTS.md`
2. read all files under `/docs`
3. inspect the repository
4. identify contradictions or unclear decisions
5. propose the initial technical implementation plan
6. recommend the backend framework
7. recommend the database access layer
8. recommend the authentication strategy
9. recommend the initial monorepo/tooling setup
10. identify risks

Codex should not modify files during this first review unless explicitly instructed.

This allows the project owner to approve the initial technical direction before code generation begins.

---

# 105. Second Codex Task

After approving the technical direction, Codex may create the initial project foundation.

This should be limited to:

- monorepo/tooling
- project shells
- infrastructure foundation
- CI foundation
- documentation of selected architecture decisions

Do not implement product features yet.

---

# 106. Third Codex Task

After the project foundation is verified, begin Phase 1 incrementally.

The first Phase 1 implementation should be a small, testable authentication/identity foundation.

Do not request that Codex implement all Phase 1 requirements at once.

---

# 107. Production Deployment Rule

Do not deploy to production merely because a roadmap phase is complete.

Production requires:

- successful staging
- required tests
- security requirements
- backups
- monitoring
- controlled secrets
- explicit production approval

---

# 108. Roadmap Success Criteria

The roadmap succeeds when the project remains:

- understandable
- testable
- secure
- deployable
- maintainable
- incrementally valuable

The objective is not maximum coding speed.

The objective is sustained development speed without sacrificing security or product quality.

---

# 109. Relationship to Other Documents

Product specification:

`docs/PRODUCT.md`

Architecture:

`docs/ARCHITECTURE.md`

Security:

`docs/SECURITY.md`

Permissions:

`docs/PERMISSIONS.md`

Testing:

`docs/TESTING.md`

Codex instructions:

`AGENTS.md`

This roadmap defines implementation order and scope discipline.

---

# 110. Final Roadmap Rule

The Church Platform is a large system.

It must be built as a sequence of secure, tested, reviewable increments.

The correct approach is:

```text
Foundation
→ Identity
→ Tenancy
→ Permissions
→ Core church functionality
→ Communication and events
→ Advanced modules
→ Sensitive data
→ SaaS and production hardening
```

not:

```text
Build everything at once.
```

## Task 1.12 mapping

Task 1.12 — Roles & Permissions Foundation maps to Phase 1F. It establishes internal
tenant-scoped role bundles, assignments and centralized permission evaluation only.
No public mutation API, standard role activation or privileged capability is enabled.
Task 1.7 secure TOTP remains BLOCKED by upstream Better Auth issue #10387; privileged
assurance and administrative/ownership functionality remain deferred.

## Historical Task 1.7a / 1.7b acceptance boundary (superseded below)

Task 1.7a prepares canonical encrypted enrollment and backup material, native
recovery rotation and password-protected disable. Task 1.7b-1 adds the separately
reviewed generation-bound enrollment confirmation described below;
TOTP and backup-code login completion are blocked in all application environments.
No trusted devices, assurance, privileged roles, Primary Owner or elevation are
activated. Task 1.13 is not part of this work.

Task 1.7b needs either an explicitly approved upstream version proving at most
one acceptance per TOTP timestep across sequential and concurrent independent
challenges, or a separately reviewed durable database-backed atomic replay guard.
Neither an upgrade nor that guard is implemented in Task 1.7a. Before an upstream
upgrade: review security/changelog impact, pin the version, regenerate/compare
schema and migrations, run both replay probes and the full authentication suite,
and only then review enabling trusted verification. No automatic upgrade or
activation is allowed.

## Task 1.13 mapping

Task 1.13 — Non-Privileged Standard Roles maps to Phase 1G. It prepares the Group
Leader, Area Leader, Event Administrator and Children’s Worker system identities
and explicit tenant-scoped, idempotent provisioning. All four canonical bundles
are deliberately empty until their assigned-object/operational authorization
exists; no church-wide substitute, automatic assignment or public management API
is enabled. They are not fully operational roles yet. Main Church Administrator
remains blocked behind Task 1.7b/privileged assurance; Primary Owner and Platform
Superadmin remain outside tenant standard-role provisioning.

## Task 1.14 mapping

Task 1.14 — Church Verification State Foundation maps to Phase 1J. It implements
the five-state domain policy and internal tenant-side request persistence only.
Platform approval/rejection/revocation remain policy-only: platform review
persistence, reviewer authority, evidence/metadata, audit trail and UI are deferred.
Verification trust metadata grants no user privilege.

Task 1.7a and Task 1.13 remain complete; Task 1.7b remains BLOCKED. Phase 1H Primary
Owner activation, Phase 1I onboarding that creates an owner, and Phase 1K privileged
administration await secure second-factor assurance. Phase 1J's internal metadata
foundation can proceed without activating any of those capabilities.

## Task 1.15 — Assurance, Elevation & Step-Up Foundation

Historical baseline: login/issuance gate statements here are superseded by Task 1.7b-2 below.

Maps to Phase 1L. Implements internal session-bound assurance storage and the
15-minute inactivity / eight-hour maximum elevation and separate five-minute
critical step-up policies, lifecycle invalidation and combined permission checks.
Production assurance completion remains fixed disabled. Task 1.7a and Task 1.14
remain complete; Task 1.7b remains BLOCKED and must supply reviewed replay-safe
proof before trusted assurance can be issued. No privileged role, Primary Owner,
ownership transfer, privileged onboarding or administration is activated.

## Task 1.7b-1 — transactionally consistent two-factor enrollment

Task 1.7a and Task 1.15 remain complete. This subtask adds application-owned
PostgreSQL generation binding and serialization around native enrollment, its
confirmation and disable. Pending may replace pending; a verified factor cannot
be replaced through this flow. Concurrent confirmation/replacement uses database
ordering and exact setup-material binding. Confirmation preserves the existing
session's absolute age and issues no assurance.

Production TOTP and recovery-code login remain disabled. Task 1.7b activation,
verified-factor change/reset and privileged activation require separate review.
No custom TOTP replay guard or dependency change is included. Task 1.16 has not
started. The existing upstream limitation and permanent probe remain recorded;
this enrollment subtask does not resolve or re-analyze that limitation.

Task 1.7b-1 was reviewed and committed at
`12ae3c25c917c3831ed2e7b92489598b6e1565b6`; login activation is covered below.

## Task 1.7b-2 — TOTP/recovery login and assurance proof

Task 1.7a: complete. Task 1.7b-1: complete. Task 1.7b-2: complete. Task 1.15: complete.
Task 1.7b-2 activates native factor login and separate server-only elevation/step-up
proof completion, preserving the reviewed enrollment transaction architecture.
Task 1.7 is complete with the documented temporary security exception for
`better-auth/better-auth#10387`. This implementation has been reviewed and approved.

TOTP authentication is active with a temporary accepted replay limitation tracked
by `better-auth/better-auth#10387`. Earlier task sections describing closed gates
record their historical baseline; this decision supersedes those blockers. It does
not claim RFC 6238 §5.2 replay compliance and adds no replay workaround. The issue
must be reconsidered when a complete released upstream fix becomes available.

Ordinary factor login does not issue elevation. Explicit proof remains session-bound
and server-authoritative; no public assurance completion API or privileged feature
is activated. Primary Owner, Main Church Administrator, privileged onboarding,
trusted devices and factor-change/reset workflows still require separate review.
No next roadmap task or Task 1.16 is started by this work.

## Task 1.16 — Primary Owner Foundation

Task 1.16 maps to Phase 1H. It provides an application-owned ownership relationship
and minimal mandatory ownership audit, with tenant-safe constraints/RLS, authenticated
self-establishment and internal atomic transfer requiring both elevation and recent
step-up. Initial and receiving owners must be current members with verified/enabled
2FA. No unaudited internal-transfer exception exists.

At most one owner is enforced now; zero is allowed during provisioning. Later normal
onboarding must establish one eligible owner. No onboarding or ownership HTTP API,
Main Church Administrator, Platform Superadmin, owner-removal or recovery workflow
is introduced. Task 1.7 remains complete with its separately documented temporary
`better-auth/better-auth#10387` exception. Task 1.17 has not been started.

Task 1.16 implementation is uncommitted and returned for review after validation.

## Task 1.17 — Church Onboarding Foundation

Task 1.17 maps to Phase 1I and is complete. It established the internal foundation;
Task 1.18 adds its HTTP boundary below. No onboarding UI is mounted.
Initial onboarding explicitly requires an authenticated session and verified/enabled
2FA, without elevation or recent step-up. Existing ownership transfer remains
subject to elevation and recent step-up. Atomic provisioning creates Church (active,
unverified), creator Member, Primary Owner, mandatory ownership audit and the four
nonprivileged standard system roles with empty bundles and no assignments.

The server allocates new-tenant scope, enforces existing RLS and uses one transaction
for every stage; any failure rolls back all artifacts. No Main Church Administrator,
verification submission, general administration or new schema is included. Task 1.7
remains complete under the separately documented temporary #10387 exception.
Task 1.18 is defined below as a separate HTTP exposure task.

## Task 1.18 — Public Church Onboarding API

Task 1.18 exposes the completed Task 1.17 Phase 1I foundation through only authenticated
`POST /api/v1/churches`, returned uncommitted for review. Valid session, verified/enabled
2FA and exact trusted Origin are required; initial onboarding requires no elevation
or recent step-up. Three attempts per user per sliding hour are allowed locally.
Strict canonical input cannot select creator, owner, tenant ID, state, roles or grants.

The unchanged atomic service provisions active/unverified Church, creator Member,
Primary Owner, mandatory audit and four empty nonprivileged system roles with zero
assignments. Response mapping is explicit/no-store. General church administration,
Main Church Administrator, Platform Superadmin, role/member management, ownership-
transfer API and frontend onboarding remain deferred. Task 1.7's temporary #10387
exception remains unchanged. Task 1.19 is not started or defined here.

## Task 1.19 — Main Church Administrator Foundation

Task 1.19 maps to the Phase 1G / Phase 1K bridge. The approved canonical privileged
system role adds exactly `members.manage` and `church.settings.manage`, each requiring
member status, current verified/enabled 2FA and exact-session elevation, with no
recent step-up requirement for these ordinary operations. Sensitive member data,
critical settings, role delegation, church deletion, ownership and platform authority
are excluded and remain separately reviewed work.

Explicit provisioning and Task 1.17/1.18 onboarding now create five canonical roles
and zero assignments. The existing four roles remain empty/nonprivileged. Existing
churches require explicit reconciliation; no startup seed or migration is introduced.
Primary Owner remains separate. Task 1.19 introduced no general administration API
or UI. The temporary Better Auth #10387 exception is unchanged. Task 1.19 is complete;
the approved Task 1.20 scope is recorded below.

## Task 1.20 — Base Church Administration API

Maps to Phase 1K. Implemented for review: ordinary church-settings PATCH and read-only
member administration listing, using the two Task 1.19 privileged permissions.
Settings mutations include atomic application-owned admin audit. Membership status
workflows and all membership mutations remain deferred. No frontend administration,
role assignment, ownership API, deletion or security-sensitive settings are included.
Task 1.21 is not started. The temporary Better Auth #10387 exception is unchanged.

### Task 1.21a — Google Pre-Authentication Bridge

Maps to Phase 1A and Phase 1L non-bypass. Internal bridge foundation completed for review; Google production authentication remains disabled. Native callback session creation is suppressed for verified/enabled-factor users, who receive only pre-auth state. Already-linked no-factor identities can authenticate internally without a password or assurance. New social signup and public linking are not activated.

Task 1.21b remains unstarted: native TOTP/recovery completion, atomic challenge/session transition, public callback integration, required authentication security events and throttling must be reviewed before activation. Apple, mobile transport and frontend authentication remain deferred. The separate accepted better-auth/better-auth#10387 exception is unchanged.
