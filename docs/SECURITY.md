# Church Platform – Security and Privacy Specification

## 1. Purpose

This document defines mandatory security and privacy requirements for the Church Platform.

Security is not an optional enhancement.

It is a core product requirement.

The platform will process personal and potentially highly sensitive information, including:

- account information
- contact information
- church membership information
- child information
- emergency contacts
- pickup permissions
- medical notes
- allergies
- private prayer requests
- direct messages
- internal church information
- administrative notes

Therefore security and privacy requirements must be considered in:

- database design
- API design
- authorization
- frontend behavior
- logging
- file storage
- background jobs
- backups
- infrastructure
- administration tools
- testing

Security requirements may not be removed merely to simplify implementation.

---

# 2. Security Principles

The platform follows these principles:

1. Privacy by default
2. Least privilege
3. Defense in depth
4. Server-side authorization
5. Explicit tenant isolation
6. Secure defaults
7. Minimize stored sensitive data
8. Audit critical actions
9. Protect secrets
10. Assume client input is untrusted
11. Minimize superadmin access
12. Fail safely
13. Do not silently bypass security checks

When convenience conflicts with security for sensitive operations, security takes priority.

---

# 3. Trust Boundaries

The following must be treated as untrusted:

- mobile clients
- web browsers
- user input
- URL parameters
- API request bodies
- query parameters
- uploaded files
- client-side role information
- client-provided tenant IDs
- client-provided user IDs
- external webhook payloads
- external URLs
- imported CSV or Excel files

Never assume that data sent by the client is trustworthy because the UI generated it.

All important validation and authorization must happen server-side.

---

# 4. Authentication

Authentication must be centralized.

Use Better Auth behind the application-owned NestJS AuthModule, as accepted in [ADR 0003: Authentication and Sessions](adr/0003-authentication-and-sessions.md). Library defaults never override application authorization or security policy.

The canonical Better Auth tables are platform-global security records in `public`,
not church-tenant tables. They have no tenant field or tenant RLS policy; access
remains behind AuthModule and application-owned account/security authorization.
Their presence does not grant church administrators access to identities, sessions,
or provider credentials. The generator owns library field definitions; reviewed
application Drizzle migrations own deployment. Default schema validation is enabled
and startup never migrates the database. Task 1.3 enables backend email/password
registration and requires verification before password sign-in. Linking and other
authentication workflows remain deferred; sessions remain PostgreSQL-backed opaque
credentials.

Signup and email verification both disable automatic sign-in. Verification links
expire after one hour. Better Auth's trusted-origin checks remain explicitly active,
including in tests, to reject unsafe callback destinations. Unknown/protected signup
fields are rejected by an application hook. Better Auth lowercases email addresses;
duplicate signup returns HTTP 200 with a synthetic user and null token instead of
disclosing the stored identity. No custom email normalization is applied.

Email delivery is application-owned and provider-neutral. Without a configured
transport, signup and resend fail before database writes; production never uses a
no-op sender. The in-memory capture implementation exists only in test code and
rejects non-test use. Library diagnostic messages are reduced to fixed error/warning
messages so submitted URLs, credentials and database details are not logged. Future
auditing must add deliberate, sanitized event metadata rather than raw library logs.

Accepted native Better Auth 1.7.4 email-verification links use short-lived,
JWT-formatted tokens signed with Better Auth's secret and containing the email
claim. Signature and expiry are checked server-side. This flow does not persist,
consume or delete a verification-token database record; the canonical `verification`
table is retained unchanged. Revisiting a still-valid link after verification is
idempotent: no additional user/account or authenticated session is created, and no
privilege, tenant or role state changes. Verification only changes email ownership
state. These tokens are not authentication sessions: normal sessions remain opaque
server-side PostgreSQL sessions, with no JWT session/access/refresh architecture or
JWT plugin.

Stateless signed verification links cannot be individually revoked or consumed
server-side before expiry. The current mitigations are one-hour expiry, a strong
Better Auth secret, trusted callback/origin validation, no automatic authenticated
session after verification, and limiting verification to email ownership state.
This has residual replay risk. Individually revocable or strictly one-time links
would require a deliberate application-owned verification mechanism and a separate
architecture decision; no such mechanism is implemented now. Production access
logs must also redact verification URL queries when email transport/deployment is
introduced.

Better Auth's built-in limiter remains at its defaults: production-only, in-memory,
100 requests per 10 seconds generally, 3 per 10 seconds for signup/sign-in, and 3 per
60 seconds for verification-email requests. Tests/development do not enable it by
default. Configure trusted client-IP/proxy handling before public deployment;
without a trusted IP it falls back to a shared per-path bucket. Multi-instance
coordination and complete abuse protection remain future work; no Redis is added.

Supported initial methods:

- email and password
- Google
- Apple

Email verification is mandatory before full account use.

Google/Apple users need no additional local password. Account linking/unlinking must be explicit, require recent authentication and appropriate assurance, and prove account/provider control. Never merge accounts solely because email addresses match. Notify users of provider changes where practical.

Authentication must support:

- login
- logout
- password reset
- email verification
- email address change
- session revocation
- multiple active devices
- two-factor authentication
- security notifications

---

# 5. Password Security

Passwords must never be stored in plaintext.

Use a modern memory-hard password hashing algorithm. Argon2id is preferred where the authentication integration permits application-controlled hashing. Select and test parameters during implementation; any integration limitation requires explicit review rather than weaker silent defaults.

Do not use:

- MD5
- SHA-1
- unsalted SHA-256
- reversible encryption for password storage

Password verification must use the same secure password hashing system.

Task 1.3 explicitly retains Better Auth 1.7.4's built-in scrypt hashing: the Node
implementation uses N=16384, r=16, p=1, a random 16-byte salt and a 64-byte key, with
NFKC password normalization. Only the salted hash is stored in `account.password`.
The configured password length is 12–128 characters, without composition rules.
No algorithm switch or hashing dependency is introduced in this task.

---

## 5.1 Password Rules

Avoid unnecessarily complicated password rules.

Prefer:

- reasonable minimum length
- allowing long passwords
- allowing password managers
- avoiding arbitrary complexity requirements where possible

Do not silently truncate passwords.

---

# 6. Password Reset

Password reset must use:

- a cryptographically secure reset token
- short token lifetime
- single-use tokens

After successful password reset:

- invalidate the reset token
- revoke all existing account sessions, including mobile sessions and elevation/step-up state
- notify the user by email

Reset endpoints should be rate-limited.

Password reset must not satisfy or disable mandatory privileged 2FA. Audit successful reset events.

Do not reveal whether an email address exists in the system through obvious response differences.

Task 1.5 uses native Better Auth password reset: a random opaque token references a
`verification` record, expires after one hour, and is atomically consumed before
updating a password. Invalid/expired/consumed tokens fail, including concurrent
reuse. Successful reset revokes all the user's sessions and never auto-signs in.
No custom token cryptography or verification table/schema change is introduced.
Reset cannot implicitly create a local password on an identity without a credential;
explicit social-account password creation remains deferred.

Authenticated password change requires the current password and a different
NFKC-normalized new password, using the same native scrypt and 12–128 limits as
signup/reset. It always revokes other own sessions while preserving the current
session's original creation time and 30-day limit. Client opt-out is ignored.
Session tokens remain absent from JSON and diagnostics. Wrong passwords do not
change credentials or sessions, and other users' accounts/sessions remain isolated.

Delivery availability is checked before account lookup, including for unknown email;
an unavailable provider yields the same 503 independently of account existence.
With delivery configured, native generic reset status/body are identical for known
and unknown accounts. Mail delivery is tracked asynchronously, never awaited only
for the known-account HTTP path. Errors are logged without recipient, URL, token or
provider details and pending work is drained on graceful shutdown. Native dummy
lookup reduces database timing differences but is not a constant-time guarantee;
this does not claim complete elimination of statistical timing side channels.
No durable queue or production provider is implemented. Provider timeouts, crash
recovery and operational alerting must be addressed before public mail deployment.

Password changes/recovery updates emit security events containing only necessary
internal identifiers and outcomes, and dispatch a distinct password-change notice.
No passwords, hashes or recovery/session credentials enter those events. Native
reset invokes the notice after password update but before all-session deletion;
failed revocation is an error, not a completed-reset success. Password/token/session
changes are not one transaction; partial failures require explicit recovery.

The unchanged production in-memory limiter allows 3 password changes per 10 seconds,
3 reset requests per 60 seconds, and the general 100 requests per 10 seconds for
reset completion. It is not distributed. Origin/CSRF checks remain enabled. The
native reset callback necessarily carries the token in its URL and trusted redirect;
deployment access logs must redact both path/query credentials, and future reset UI
must avoid third-party content and token persistence. No reset token is returned in
ordinary JSON, application logs or diagnostics.

---

# 7. Email Address Changes

Users may change their account email address.

Require recent authentication within the five-minute step-up window and the account's required assurance.

The new email must be verified before becoming fully active.

Security notification must be sent to the old email address.

The notification should indicate that the account email was changed or that a change was initiated.

Critical account changes should be audit logged.

---

## Task 1.6 email-change enforcement

Native Better Auth 1.7.4 changeEmail remains disabled following the specific stale-link
address-reassignment reproduction recorded in ADR 0007. The application workflow
binds user ID permanently and checks the original email snapshot at each transition.
An older token cannot act on a new owner of that address. New requests supersede old
incomplete workflows. Both 256-bit opaque tokens are stored only as SHA-256 hashes,
consumed once under locks, and expire at the original one-hour deadline.

Creation requires an authoritative normal session with Task 1.4's absolute lifetime.
Both mailbox proofs are mandatory, including for unverified current email. Final
identity update and session revocation are atomic; only the original valid initiating
session may survive. Password/provider identity does not change. No auto-login occurs.

All routes are POST and require exact configured Origin; no arbitrary callbacks or
protected body fields are accepted. Fixed future UI links carry tokens in fragments,
never server query logs. Future UI must keep fragments out of telemetry and third-party
content. Native router limits explicitly cover the application endpoints: creation
3/minute, each redemption 10/minute per source IP, using the existing production
single-instance memory limiter. Trusted proxy/IP configuration and distributed limits
remain deployment responsibilities; no Redis was introduced.

Required approval/verification delivery is temporarily awaited while the security
transaction remains open, with a five-second timeout. Provider failure or timeout
rolls back creation/consumption, so approval can retry. The local timeout does not
necessarily cancel external provider work: a provider may deliver after rollback.
That late email contains a token without the corresponding committed workflow state
or advancement, so it is unusable, including after a later normal retry. This is a
UX/operational limitation, never an authorization fallback. Delivery is not
exactly-once; durable provider/outbox design remains deferred.
Post-commit informational notice failure is logged without sensitive values and does
not reverse the verified change. Mail and PostgreSQL are not one atomic delivery
system. In-process work drains on shutdown but needs a production provider/outbox for
crash durability. This foundation does not claim privileged or five-minute step-up
implementation. See [ADR 0007](adr/0007-application-owned-email-change.md).

# 8. Two-Factor Authentication

2FA is mandatory for:

- Primary Owner
- main church administrators
- platform superadmins

2FA is optional for normal users.

Mandatory 2FA follows effective protected capabilities, including custom roles; permission/capability metadata must carry assurance requirements. Google/Apple and other social sign-ins must not bypass TOTP. Enrollment alone is not current-session assurance. Safe grant, disable/reset, recovery, and revocation transitions must prevent protected capabilities remaining usable without required 2FA, as specified in ADR 0003.

Architecture should allow future expansion of supported 2FA methods.

Initial implementation uses:

- TOTP authenticator applications

Avoid SMS as the primary recommended method where stronger alternatives are available.

Support recovery codes with TOTP. Code regeneration/revocation requires an appropriately authorized recent-authentication flow; regeneration invalidates the old set.

Recovery codes must:

- be generated securely
- be shown once where appropriate
- be stored securely, preferably hashed
- be single-use

---

# 9. Step-Up Authentication

Highly sensitive actions require recent re-authentication.

The initial freshness window is five minutes. Linking/unlinking providers and disabling/resetting 2FA also require step-up. Proof must suit the account and operation without forcing social-only users to create a password or downgrading privileged 2FA. A normal session or rolling renewal does not establish recent authentication.

Examples:

- changing Primary Owner
- deleting an entire church
- changing critical platform security settings
- superadmin account recovery actions
- changing sensitive administrator credentials
- critical superadmin actions

Step-up authentication may require:

- password re-entry
- 2FA confirmation

Do not rely only on an old existing session for high-risk operations.

---

# 10. Sessions

Users may have multiple active sessions.

Each session should include information such as:

- session identifier
- user
- created time
- last activity
- device/browser information
- coarse approximate location where appropriate
- revocation state

Users should be able to:

- view active sessions
- revoke one session
- revoke all other sessions

---

## 10.1 Session Tokens

Session tokens must:

- be unpredictable
- have appropriate expiration
- support revocation
- never be logged
- never appear in analytics data

Use PostgreSQL-backed server-side sessions with opaque credentials, not an application JWT access/refresh architecture initially. Authoritative checks must enforce immediate server-side invalidation; do not enable cookie-cached/stateless acceptance that delays revocation.

Task 1.4 enforces normal web sessions with explicit seven-day rolling expiry,
one-day refresh threshold, and application-owned 30-day absolute expiry. At
`createdAt + 30 days <= now`, before hooks delete the row and prevent native session
resolution/refresh; invalid timestamps and storage errors fail closed. Creation time
never moves during sliding refresh. Activity before the native refresh threshold
does not update the database, so the rolling deadline is measured from the last
qualifying refresh, not every HTTP request. Mobile/elevation/step-up rules below
remain future work and cannot be selected by an untrusted client label.

Password login remains verification-gated; unknown emails and incorrect passwords
share the same error. Session credentials are filtered from browser JSON, including
login and session lists. Management accepts non-secret `sessionId` values, resolves
only owned records, and delegates deletion to Better Auth's canonical endpoint.
Single, other, and all-session revocation are user-scoped; all includes current.
Logout verifies server-side deletion before reporting success, since native sign-out
otherwise catches deletion failures. Session-store diagnostics are sanitized.

Cookies retain `HttpOnly`, `SameSite=Lax`, `Path=/`, and host-only scope (no domain
override). Local HTTP uses `better-auth.session_token`; HTTPS uses its `__Secure-`
prefix and `Secure`. Production explicitly requires secure cookies even if an HTTP
base URL is misconfigured; deployments must still provide HTTPS and the correct
origin. No credential is exposed in ordinary response headers/JSON or logs. Cookie
cache and secondary storage remain disabled. User-agent and available IP metadata
come from Better Auth's request handling and are untrusted display/abuse metadata,
not authentication assurance. No geolocation is collected. Trusted reverse-proxy/IP
configuration and shared multi-instance rate limiting remain deployment work; the
existing production in-memory limiter has not been disabled or made distributed.

Initial policy defaults from ADR 0003:

| Scope | Inactivity | Absolute limit / freshness |
|---|---|---|
| Normal web session | 7 days | 30 days absolute |
| Normal mobile session | 30 days | 90 days absolute |
| Privileged elevation | 15 minutes | 8 hours maximum |
| Critical-operation step-up | Not sliding | Authentication within 5 minutes |

Normal session validity, elevated assurance, and recent step-up are distinct. Enforce the earliest applicable expiry server-side; renewal must not reset absolute lifetime or create authentication assurance. Later configuration must not weaken required platform security.

---

# 11. Client Storage

Sensitive authentication tokens must use secure client storage.

Mobile:

Store opaque bearer session credentials in operating-system secure storage, never ordinary unprotected preferences. They remain server-revocable.

Web:

Use HttpOnly cookies, Secure in HTTPS environments, appropriate SameSite, and narrow cookie scope. Do not expose session credentials through ordinary frontend JavaScript or session-list responses.

Do not place authentication credentials in:

- localStorage
- URLs
- browser history

Cookie names and exact domain topology are deferred to deployment design.

---

# 12. Multi-Tenant Isolation

One church equals one tenant.

Tenant isolation is mandatory.

Every server-side request involving tenant-owned data must verify:

1. authenticated user when required
2. target tenant
3. applicable access class/relationship to target tenant
4. required permissions and privacy rules
5. object-level access where applicable

Never trust a tenant identifier merely because the client supplied it.

Public church resources do not require membership; authenticated-user, follower, member, object-authorized, administrative, and ownership operations each enforce their applicable policy. Use trusted server-created tenant context, explicit query scoping, transaction-local PostgreSQL RLS from the first tenant-owned tables, and cross-tenant relationship constraints. Missing context fails closed. RLS does not establish entitlement or replace application authorization. See [ADR 0006](adr/0006-tenancy-and-authorization.md).

---

# 13. Tenant Isolation Example

Assume:

User X belongs only to Church A.

The following must fail:

```text
GET /api/v1/churches/B/members
```

even if User X manually changes the church ID.

The same rule applies to:

- API requests
- GraphQL requests if ever used
- file access
- search
- exports
- background jobs
- cached data
- notifications
- realtime subscriptions

---

# 14. Mandatory Tenant Tests

Every module handling tenant-specific data must have automated tenant isolation tests.

At minimum test:

- allowed access inside the tenant
- denied access to another tenant
- denied access without required role
- denied access after membership removal

Tenant isolation tests are release-blocking tests.

---

# 15. Server-Side Authorization

Authorization must never exist only in frontend code.

Frontend permission checks improve UX but are not security boundaries.

Every protected backend action must enforce authorization independently.

Example:

The frontend may hide the “Delete Member” button.

The backend must still reject unauthorized delete requests.

---

# 16. Least Privilege

Users and administrators should receive only the permissions needed for their responsibilities.

Examples:

An event administrator may manage:

- event registrations
- participants
- check-in

but must not automatically receive:

- member administration
- church billing
- role management
- church ownership permissions

An area leader may manage their area without automatically becoming a church-wide administrator.

---

# 17. Permission Changes

Permission changes are security-sensitive.

Changes involving:

- roles
- administrative rights
- Primary Owner
- superadmin rights
- sensitive data permissions

must be audit logged.

Privilege changes should take effect promptly.

Do not rely on indefinitely cached authorization state.

---

# 18. Primary Owner Security

Each church has exactly one Primary Owner.

Only the current Primary Owner may normally transfer ownership.

Other church administrators must not be able to remove or replace the Primary Owner.

Ownership transfer requires:

- authenticated Primary Owner
- recent step-up authentication
- mandatory active 2FA
- eligible receiving account
- audit event

Ownership transfer must preserve exactly one Primary Owner transactionally, including concurrent attempts and failures.

The receiving account should explicitly accept ownership where practical.

---

# 19. Platform Superadmin

Platform superadmin is a highly privileged role.

Superadmin access must be minimized.

Superadmins may manage:

- churches
- verification
- plans
- configuration
- support cases
- platform audit information

Superadmin status must not automatically mean unrestricted visibility into all private user content.

---

# 20. Superadmin Private Content Boundaries

During normal operation superadmins must not be able to freely read:

- private direct messages
- private prayer requests
- private Bible notes
- private personal notes

If exceptional emergency access is ever introduced later, it must:

- have a documented lawful and operational purpose
- require strong authorization
- require step-up authentication
- be strictly limited
- generate a prominent audit event

Do not implement “view everything” functionality by default.

---

# 21. Privacy by Default

Optional personal information must be private until intentionally shared.

Examples:

- birthday
- phone number
- address
- groups
- service areas
- biography

Do not default optional personal data to public visibility.

---

# 22. Public Profile Information

The product model may expose:

- username
- profile picture

as basic platform identity according to product rules.

All additional information requires appropriate visibility rules.

Do not accidentally expose internal membership or administrative information through public profiles.

---

# 23. Sensitive Data Categories

Treat the following as sensitive or highly sensitive:

## Sensitive

- home address
- phone number
- birthday
- membership status
- internal member fields
- administrative remarks

## Highly Sensitive

- child data
- allergies
- medical information
- emergency contacts
- pickup permissions
- private prayer content
- private direct messages
- protected pastoral information if introduced
- account recovery data

Highly sensitive data requires stronger access control.

---

# 24. Child Data

Child data requires special protection.

Access must follow need-to-know principles.

A normal church member must never gain access simply because they belong to the same church.

Possible authorized users may include:

- linked parent/guardian
- authorized children’s ministry leader
- authorized current caregiver
- specific event staff

Authorization depends on role and context.

Highly sensitive child access requires explicit permission, valid operational context, current need-to-know, and appropriate audit logging. Permission alone is insufficient, including for administrators and the Primary Owner. Guardian access derives from the explicit authorized guardian relationship and its allowed actions.

---

# 25. Medical and Allergy Information

Medical notes and allergy information must be accessible only where operationally necessary.

Example:

An authorized caregiver for a current children’s event may need access.

An unrelated administrator should not automatically need access.

Viewing highly sensitive data should be access logged where required.

---

# 26. Pickup Permissions

Pickup permissions for children must be protected as sensitive data.

Only authorized users should see:

- who may pick up the child
- relevant pickup restrictions
- current event pickup state

Do not expose these details through broad member search or general profiles.

---

# 27. Sensitive Data Access Logging

Changes to sensitive information must be audited where appropriate.

For highly sensitive information, selected read access should also be logged.

Example:

An authorized worker opens a child’s allergy information.

The access event may record:

- actor
- child/person
- tenant
- data category
- timestamp
- relevant event/context

Do not log the sensitive value itself into the audit event.

---

# 28. User Transparency

Users and parents should be able to understand which roles or types of authorized persons may access sensitive data.

Do not necessarily expose full internal access logs containing other staff personal data.

Provide meaningful transparency without creating additional privacy issues.

---

# 29. Direct Messages

Direct messages are private communication.

Platform administrators must not normally be able to read them.

The architecture should protect message content from routine administrative access.

At minimum:

- message access requires conversation participation
- normal admin APIs must not provide arbitrary message browsing
- database/admin tooling must be operationally restricted
- message content must not appear in application logs

A future stronger encryption design may be considered.

Do not falsely claim end-to-end encryption unless true E2EE is actually implemented and verified.

---

# 30. Prayer Privacy

Prayer requests may have different protected audiences.

Examples:

- private
- friends
- selected group
- selected church
- anonymous inside selected audience

A private prayer request must never appear in:

- global search
- public feeds
- public church pages
- superadmin content browsing

Audience checks must be enforced server-side.

---

# 31. Bible Notes

Personal Bible notes and highlights are private by default.

They must not become visible to:

- church administrators
- group leaders
- platform superadmins

unless the user explicitly shares them through a future supported feature.

---

# 32. Administrative Notes

Church administrators may maintain protected internal notes where product rules permit.

These notes must:

- have restricted permissions
- never appear in normal member profiles
- never appear in public search
- never be returned through generic member APIs

Access and changes should be auditable where appropriate.

---

# 33. Files

Objects are private by default. PostgreSQL metadata/resource relationships authorize application access; S3 keys and prefixes do not. Production storage should be EU-hosted behind the application abstraction in [ADR 0004](adr/0004-object-storage.md).

Uploaded files must be treated as untrusted.

Possible threats include:

- malware
- malicious file names
- oversized uploads
- unsupported file types
- executable files
- script injection
- content-type spoofing

---

# 34. File Upload Validation

File upload handling should validate:

- file size
- allowed file type
- content type where possible
- extension
- filename

Never rely solely on the filename extension.

Rename stored objects to controlled internal identifiers.

Do not use raw user filenames as storage paths.

---

# 35. File Names

Original filenames may be stored as metadata for display.

Storage object names should use safe generated identifiers.

Prevent:

- path traversal
- directory escape
- control character abuse
- unsafe HTML rendering

---

# 36. File Download Authorization

Private files require authorization at download time.

Examples:

- group documents
- task attachments
- internal event attachments
- protected child documents if ever supported

Do not expose permanent public object storage URLs for private files.

Use:

- authenticated delivery
- short-lived signed URLs

where appropriate.

Signed download URLs are bearer capabilities that can remain usable within their validity after application permission changes. For current-user checks or immediate revocation, use authenticated delivery; highly sensitive files should prefer current authorization as specified in ADR 0004.

---

# 37. Malware Protection

Architecture should allow malware scanning of uploaded files.

It may be implemented later depending on infrastructure complexity, but the upload pipeline should not prevent future integration.

High-risk executable formats should not be accepted in normal user uploads unless specifically required.

---

# 38. Images

Uploaded images must be handled safely.

If image processing is introduced:

- use maintained libraries
- restrict input size
- protect against decompression bombs
- strip unnecessary metadata where appropriate
- avoid exposing private EXIF location information unintentionally

---

# 39. External URLs

User-entered links must be treated as untrusted.

Protect against:

- javascript URLs
- unsafe URL schemes
- phishing-style rendering

If the backend fetches external URLs in the future, protect against SSRF.

Never allow unrestricted backend requests to arbitrary private network addresses.

---

# 40. Input Validation

All externally supplied data must be validated.

Use schema validation at API boundaries.

Validate:

- types
- lengths
- allowed values
- required fields
- formats
- identifiers

Reject unexpected data.

Reject unknown fields and protected ownership/privilege fields outside the accepted request DTO. Created tenant ownership comes from validated server context.

Do not silently accept arbitrary extra privileged fields from request payloads.

---

# 41. Mass Assignment

Prevent mass-assignment vulnerabilities.

Example:

A normal profile update request must not allow a malicious client to submit:

```text
isSuperAdmin = true
```

Use explicit DTOs and allowed fields.

Do not directly deserialize user input into database entities.

---

# 42. SQL Injection

Use parameterized database queries or a secure ORM/query builder.

Never create SQL statements by concatenating untrusted user input.

Raw SQL must receive additional review.

---

# 43. Cross-Site Scripting

User-generated content must be safely rendered.

Protect against XSS in:

- posts
- comments
- profiles
- group content
- event descriptions
- sermon descriptions
- administrative fields

Prefer framework-safe escaping.

If rich text or HTML is supported, sanitize it using a maintained allowlist-based sanitizer.

---

# 44. CSRF

Cookie-authenticated state-changing requests require appropriate CSRF protections.

Examples may include:

- SameSite cookies
- CSRF tokens
- origin validation

The exact approach depends on the chosen authentication architecture.

Validate Origin where applicable and finalize mechanisms against the browser/API topology. CORS is not CSRF protection. Reject unsafe cross-origin credential use; mobile bearer support must not disable browser protections.

---

# 45. CORS

CORS policy must be explicit.

Do not use unrestricted:

```text
Access-Control-Allow-Origin: *
```

for authenticated APIs without a justified reason.

Allow only known application origins where appropriate.

---

# 46. Security Headers

Web applications should use appropriate security headers.

Consider:

- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- Strict-Transport-Security
- frame restrictions
- Permissions-Policy

The exact policy should be tested so required application functionality continues to work.

---

# 47. TLS

Production traffic must use HTTPS.

Plain HTTP should redirect to HTTPS where appropriate.

Do not transmit:

- passwords
- session tokens
- personal data

over unencrypted external connections.

---

# 48. Encryption at Rest

Where infrastructure supports it, production storage should use encryption at rest.

This includes:

- database storage
- backups
- object storage

Highly sensitive application-level encryption may be considered for selected data where it provides meaningful additional protection.

Do not invent custom cryptography.

Use established cryptographic libraries and standards.

---

# 49. Secrets

Secrets must never be committed to Git.

Examples:

- database passwords
- API keys
- private keys
- email credentials
- OAuth client secrets
- signing keys

Use environment secrets or a dedicated secret management mechanism.

---

# 50. .env Files

Real production `.env` files must not be committed.

The repository may contain:

```text
.env.example
```

with placeholders only.

`.gitignore` must protect local secret files.

---

# 51. Secret Rotation

Architecture should allow credentials to be rotated.

Examples:

- database credentials
- signing keys
- external API credentials
- SMTP credentials

Do not design systems that require source-code changes whenever a secret changes.

---

# 52. Logging

Application logs must not contain sensitive data unnecessarily.

Never intentionally log:

- passwords
- password reset tokens
- session tokens
- OAuth tokens
- 2FA secrets
- recovery codes
- private message contents
- private prayer contents
- medical information

---

# 53. Structured Logging

Prefer structured logs.

Useful log fields may include:

- request ID
- service
- tenant identifier where appropriate
- user identifier where appropriate
- operation
- duration
- error code

Avoid placing personal content into log messages.

---

# 54. Audit Logs

Audit logs are different from normal application logs.

Audit logs should capture important security and administrative actions.

Examples:

- login security events
- role changes
- permission changes
- membership status changes
- ownership transfer
- church verification changes
- payment status changes
- sensitive administrative changes
- account recovery
- church deletion request
- user deletion request

---

# 55. Audit Event Structure

An audit event should contain where appropriate:

- event ID
- timestamp
- actor
- tenant
- action
- resource type
- resource ID
- outcome
- relevant non-sensitive metadata

Do not store secret values in audit logs.

---

# 56. Audit Integrity

Audit history should be append-oriented.

Do not provide normal administrators with the ability to silently alter historical audit records.

Audit retention should later be aligned with legal and operational requirements.

---

# 57. Security Events

Important security events should trigger user notification where appropriate.

Examples:

- password changed
- email changed
- 2FA enabled
- 2FA disabled
- unusual recovery action
- ownership changed

Notifications should not reveal secrets.

---

# 58. Account Recovery

The platform may support super-recovery when a user loses access to email and normal recovery methods.

This process is highly sensitive.

Super-recovery must:

- require appropriate identity verification
- require documented reason
- require authorized superadmin
- require step-up authentication
- be audit logged
- notify the affected account through available channels where possible

Do not allow informal manual database changes as the standard recovery procedure.

No master password or universal support bypass is permitted. Recovery must not silently bypass mandatory privileged 2FA; keep protected capabilities unavailable until the approved proof/restoration process is complete.

---

# 59. Church Admin Recovery

Exceptional Primary Owner recovery is deferred and requires its own explicit security design before implementation. The following are requirements for that future process, not authorization to implement a support bypass now.

If all church administrators lose access, platform superadmin may assist after appropriate verification.

Verification should establish that the requester is legitimately authorized to represent the church.

Recovery actions may include:

- restoring administrator access
- transferring Primary Owner

All such actions must be audit logged.

---

# 60. Rate Limiting

Rate-limit abuse-sensitive endpoints.

Examples:

- login
- password reset
- registration
- verification requests
- membership requests
- public search
- reporting
- invitation endpoints

Also protect TOTP attempts, recovery-code attempts, provider linking, and security-sensitive recovery flows. Rate-limit storage and thresholds are deferred; this does not require Redis now.

Rate limits should consider:

- IP
- account
- endpoint

where appropriate.

---

# 61. Brute Force Protection

Login security should protect against brute-force attacks.

Possible controls:

- rate limiting
- progressive delays
- suspicious login monitoring

Avoid permanent account lockout mechanisms that enable easy denial-of-service attacks against users.

---

# 62. Enumeration Protection

Authentication and recovery APIs should avoid revealing unnecessary information about whether accounts exist.

Example:

Password reset may return a generic response such as:

“If an account exists for this address, a reset email will be sent.”

---

# 63. Abuse Reporting

Users may report:

- profiles
- posts
- comments
- chat messages
- other supported content

Reports related to church-internal content should normally first go to the responsible church moderation context.

Users must be able to escalate where local handling is inappropriate or insufficient.

---

# 64. Moderation

Possible moderation actions:

- hide content
- delete content
- warn user
- temporarily suspend user
- remove user from church
- platform-level account suspension

Significant moderation actions should be audit logged.

Moderation tools must respect privacy boundaries.

---

# 65. Search Privacy

Search is a potential security boundary.

Search must never reveal:

- hidden groups
- private prayer requests
- administrative notes
- sensitive child data
- unauthorized profiles
- private messages
- protected member data

Search authorization must match normal object access authorization.

---

# 66. Notification Privacy

Notifications must not expose sensitive information on lock screens unnecessarily.

Push notification text should be designed carefully.

Example:

Prefer:

“You have a new private message.”

instead of including highly sensitive message content.

Users may later be offered privacy-oriented notification preview settings.

---

# 67. Realtime Authorization

Socket.IO/NestJS gateways reuse the normal application authorization model under [ADR 0005](adr/0005-realtime.md). Validate protected subscriptions and recipient payloads server-side, respond to session/permission/membership revocation, and do not introduce a stale-permission window without security review. REST/API and PostgreSQL remain authoritative; rooms and Redis adapters are not authorization or durable history.

Realtime subscriptions must be authorized.

A user must not be able to subscribe to:

- another church’s internal channel
- another user’s private conversation
- restricted group updates

Authorization must be checked when establishing subscriptions and when relevant permissions change.

---

# 68. Background Job Security

Background jobs must preserve security context.

Jobs processing tenant-owned data must carry and validate:

- tenant identity
- target resource
- authorized operation

Do not create generic jobs that accidentally process records across tenants without explicit filtering.

---

# 69. Import Security

CSV and Excel imports are untrusted input.

Imports must validate:

- file type
- row structure
- field values
- allowed columns
- tenant ownership

Prevent spreadsheet formula injection in exported CSV/Excel files where relevant.

Imported records must always belong to the correct tenant.

---

# 70. Export Security

Data exports may contain large amounts of personal data.

Export functionality must:

- require appropriate permission
- scope data to the correct tenant
- audit significant exports
- protect generated download files
- use limited download lifetime where appropriate

Do not expose export files through permanent public links.

---

# 71. Data Minimization

Collect only information needed for the intended purpose.

Do not add fields “just in case.”

Sensitive fields should have a clear product purpose.

If a feature no longer needs certain data, consider whether continued storage is necessary.

---

# 72. Retention

Data retention must follow product and legal requirements.

Known product periods include:

- user deletion transition: 3 months
- church deletion protection period: 30 days

Exact legal retention obligations must be reviewed before production launch.

Do not make unsupported legal assumptions in code.

Retention rules should be configurable where reasonable.

---

# 73. User Deletion

Account deletion must consider:

- personal profile
- memberships
- messages
- event history
- duties
- audit history
- legal retention
- anonymization requirements

After the defined transition period, personal data should be removed or anonymized where required.

Historical references may remain in anonymized form.

---

# 74. Church Deletion

Church deletion requires:

- authorized user
- Primary Owner only in V1; church deletion authority is not delegable to ordinary custom roles
- step-up authentication
- protection period
- audit log

Deletion should not immediately destroy recoverable data.

Final deletion should be performed by a controlled background process.

---

# 75. Backup Security

Backups contain sensitive data.

Backups must be protected from unauthorized access.

Backup credentials must be separate from normal user credentials where practical.

Backups should use encryption where supported.

Backup access should be limited.

---

# 76. Restore Security

Database restore operations are highly privileged.

Production restores require authorized operational access.

Restore procedures must not accidentally restore production data into insecure development environments.

Use sanitized or synthetic data in development.

---

# 77. Development Data

Do not use real production user data in local development.

Use:

- fixtures
- factories
- synthetic test users
- anonymized datasets only when appropriately prepared

Developers and Codex should not require production data to develop features.

---

# 78. Staging Data

Staging should use synthetic/test data.

Do not automatically copy the production database into staging.

If production-like data is ever required, it must be appropriately anonymized and handled under a documented process.

---

# 79. Production Access

Production access must be limited.

Codex must not receive unrestricted production access.

Production database credentials should not be placed into:

- prompts
- repository files
- issue descriptions
- documentation
- chat conversations

Operational access should follow least privilege.

---

# 80. Dependency Security

Use maintained dependencies.

Avoid abandoned packages for security-critical functionality.

Automated dependency vulnerability scanning should be enabled.

Security updates should be reviewed regularly.

---

# 81. Lock Files

Commit appropriate dependency lock files.

Examples depend on the selected ecosystems.

Lock files improve reproducibility and dependency auditing.

Do not routinely delete lock files to resolve dependency conflicts.

---

# 82. Supply Chain Security

CI/CD secrets must be protected.

Third-party GitHub Actions or equivalent build components should be selected carefully.

Prefer trusted and maintained actions.

Pin versions appropriately for security-sensitive workflows.

---

# 83. CI Security

Pull request CI must not expose production secrets to untrusted code.

Especially protect workflows triggered by:

- external pull requests
- forked repositories
- automated dependency updates

Use separate permissions for:

- testing
- staging deployment
- production deployment

---

# 84. Production Deployment Security

Production deployment requires explicit approval initially.

Deployment should only occur from approved branches or release processes.

A successful build alone must not automatically grant production deployment permissions.

---

# 85. Security Testing

Security behavior must be tested automatically.

Examples:

- authentication tests
- authorization tests
- tenant isolation tests
- object-level access tests
- validation tests
- file permission tests
- role escalation tests
- sensitive data exposure tests

Detailed testing requirements are defined in:

`docs/TESTING.md`

---

# 86. Negative Testing

Security tests must include negative cases.

Do not only test:

“Admin can open member.”

Also test:

- normal member cannot open admin endpoint
- user from another tenant cannot access member
- follower cannot access internal member list
- revoked administrator loses access
- deleted session cannot be reused

---

# 87. IDOR Protection

Every resource lookup must consider insecure direct object reference risks.

Example:

Changing:

```text
/events/123
```

to:

```text
/events/124
```

must not reveal another user's or another tenant's protected resource.

Always combine resource lookup with authorization.

---

# 88. Privilege Escalation Testing

Test that users cannot grant themselves:

- admin role
- Primary Owner
- superadmin
- event administrator
- group leader
- sensitive data permissions

Role assignment APIs require strict authorization.

---

# 89. Security Review for New Modules

Before a significant module is considered complete, Codex must identify:

1. data handled
2. tenant boundary
3. permission model
4. sensitive fields
5. abuse cases
6. audit requirements
7. logging risks
8. relevant tests

This should be part of implementation planning.

---

# 90. Security Review for Schema Changes

Database changes involving:

- user identity
- memberships
- permissions
- roles
- children
- medical data
- private communication
- authentication

require explicit security consideration.

Do not add such fields without considering who can:

- create
- read
- update
- delete

them.

---

# 91. Security Review for New API Endpoints

Every protected endpoint must define:

- authentication requirement
- tenant context
- permission requirement
- object-level authorization
- request validation
- response filtering
- audit requirement
- rate-limit need

Endpoints without a clear authorization model must not be shipped.

---

# 92. Response Data Minimization

APIs should return only required information.

Do not use broad database entities as API responses.

Example:

A member directory endpoint should not accidentally return:

- address
- internal notes
- medical information
- email
- phone number

when only username and profile picture are permitted.

Use explicit response DTOs.

---

# 93. Error Messages

Error messages should be helpful but must not expose internal security information.

Do not expose:

- SQL errors
- stack traces
- secrets
- filesystem paths
- internal infrastructure addresses

Production clients should receive controlled application errors.

---

# 94. Security Incident Preparedness

The architecture should allow investigation of incidents.

Relevant information may include:

- security audit logs
- authentication events
- administrator changes
- deployment history
- application error logs

Do not collect excessive personal content merely for hypothetical investigations.

---

# 95. Feature Flags

Security-sensitive unfinished features should not be accidentally exposed.

Feature flags may be used where useful.

Feature flags must not replace authorization.

An attacker should not gain access merely by manipulating frontend feature state.

---

# 96. Default Deny

When permission behavior is unclear, default to denying access.

Do not default to permissive behavior because a role mapping is missing.

Unknown permissions should fail closed.

---

# 97. Failure Behavior

Security failures must fail safely.

Examples:

If permission lookup fails:

deny access.

If tenant resolution is ambiguous:

deny access.

If a signed file URL cannot be generated securely:

do not fall back to a public URL.

---

# 98. Security TODOs

Do not leave security-critical TODO comments indefinitely.

Examples:

```text
TODO: add authorization later
TODO: check tenant later
TODO: validate permissions
```

A feature containing unresolved security-critical TODOs must not be considered production-ready.

---

# 99. No Security Bypass for Testing

Development and test environments may provide test helpers.

Do not implement hidden production bypasses such as:

- master password
- secret admin URL
- universal 2FA code
- hardcoded superadmin token

Test helpers must be unavailable in production builds.

---

# 100. Security Priority Rule

When multiple implementations are possible, prefer:

1. least privilege
2. smallest data exposure
3. server-side enforcement
4. explicit authorization
5. secure defaults
6. auditable operations
7. maintainable security logic

Avoid clever security designs that are difficult to understand or test.

---

# 101. Relationship to Other Documents

Product behavior:

`docs/PRODUCT.md`

Architecture:

`docs/ARCHITECTURE.md`

Permissions:

`docs/PERMISSIONS.md`

Testing:

`docs/TESTING.md`

Roadmap:

`docs/ROADMAP.md`

This document defines mandatory security and privacy requirements.

If another document appears to permit insecure behavior, this security document should be reviewed before implementation proceeds.

---

# 102. Production Readiness Rule

Before production launch, the project must perform a dedicated security and privacy review covering at least:

- authentication
- session management
- 2FA
- tenant isolation
- permissions
- child data
- private communication
- file uploads
- exports
- logs
- backups
- production secrets
- rate limiting
- dependency vulnerabilities
- deployment permissions
- account recovery
- deletion and retention

A successful functional test suite alone does not mean the application is secure.

## Task 1.8 self-profile boundary

All extended profile fields, including DOB, phone, address and biography, are
self-only. Identity comes from the AuthModule-owned session reader with Task 1.4
absolute expiry enforcement; no body/query/route ID selects a user. Missing,
revoked or expired sessions receive 401. PATCH additionally requires the exact
configured authentication origin. No bespoke limiter, Redis, or weaker auth
policy is introduced. Responses use Cache-Control: no-store.

Unknown/protected top-level and nested address properties, empty updates, and
invalid values receive sanitized 400 responses. Username conflicts return 409;
database/session resolution failures fail closed with generic 503 responses.
No profile bodies, private field values, cookies, credentials or raw database
errors are logged. Field mapping excludes internal auth/security data.
Email and emailVerified remain exclusive to the established authentication
workflows; password/account records are never written by profile operations.
The auth compatibility name cannot be changed through profile PATCH.

The one-to-one profile and username uniqueness are database-enforced. Atomic
profile/image writes prevent partial updates on conflict. The initiating and
other sessions remain intact, retaining their original absolute-lifetime origin.
The API does not fetch image URLs; future renderers must respect privacy and
safe image loading, and must treat biography as plain text rather than HTML.
Public visibility, directories and privacy controls remain separate future work.

Task 1.7 remains blocked by Better Auth issue #10387 (the reproduced TOTP replay
behavior in 1.7.4). No two-factor plugin, schema, migration, replay workaround,
fake assurance, or privileged bypass is added by Task 1.8.

## Task 1.9 tenant isolation foundation

Church root access requires trusted server scope, explicit repository predicates,
and transaction-local PostgreSQL RLS together. Route/body identifiers are requests,
never entitlement. No church administration, creation, public record serialization,
membership, owner or permission endpoint exists. Task 1.7 remains blocked; privileged
capabilities cannot be enabled until their TOTP/assurance prerequisites exist.

The single church policy constrains reads and writes with USING and WITH CHECK;
ENABLE and FORCE RLS are migration-owned. An absent/empty/mismatched context discloses
or mutates no row. Runtime credentials must not be superuser, BYPASSRLS, table owner
or a role able to assume ownership. TenantDatabase checks these restrictions and
CREATEROLE on each protected transaction, using the same connection as the query.
It never stores a session-wide tenant setting. Role/setup errors fail closed; no
tenant values or connection strings are included in application diagnostics.

RLS supplements authorization and does not establish user entitlement. An arbitrary
application role able to set a GUC could choose a different context; trusted context
creation and future operation-specific authorization therefore remain essential.
The internal repository is infrastructure, not a public authorization API.

The local/CI fixture role can migrate/create disposable databases and restricted
test logins, but does not execute assertions claimed to prove RLS. Actual restricted
connections independently test broad SQL as well as repository scoping. Runtime
receives no TRUNCATE, ownership or schema CREATE rights; TRUNCATE is not RLS-filtered.
Uniqueness constraints can reveal a conflict even when the conflicting row is hidden;
future public mutation APIs must sanitize conflicts without revealing private records.
No shared credentials, tenant role policy, or RLS bypass is granted to clients.

## Task 1.10 relationship isolation

Membership persistence requires the existing trusted TenantContext, explicit
church_id predicates and transaction-local RLS together. The internal module is
unmounted; no client can select an authorized context or mutate relationships.
Future callers must establish operation-specific entitlement, including when
selecting a different global user. Relationship states are not roles or permission
grants; protected capabilities still require the blocked Task 1.7 prerequisites.

Both tenant tables are checked for ENABLE/FORCE RLS and runtime ownership/privileges
before tenant work. Runtime must be NOSUPERUSER, NOBYPASSRLS and neither owner nor
member of an owner role. Missing/invalid scope yields no rows; mismatched repository
and RLS scope cannot disclose or mutate either church's relationships. WITH CHECK
also rejects inserted/rewritten foreign ownership. Transaction context is local
and cannot survive commit, rollback, application/SQL errors or pool reuse.

Creation rejects churchId and all unknown fields. The database unique pair prevents
concurrent duplicates; an existing-pair outcome reveals no private user fields.
Expected-state updates retain identity and reject stale transitions without exposing
foreign records. No service diagnostics contain SQL parameters, credentials, session
data or private profiles. Global-user and church deletion cascade relationships;
no standalone relationship deletion or administrative endpoint is exposed.

## Task 1.11 tenant harness safeguards

Protected RLS assertions must use the harness's restricted runtime connections,
never its privileged fixture connections. The role validator requires a real
LOGIN, no superuser/BYPASSRLS/CREATEDB/CREATEROLE privileges, no protected-table
ownership or owner-role membership, and ENABLE/FORCE RLS on every declared
protected table. Runtime grants are CONNECT, public-schema USAGE and CRUD on
explicitly named tables only; there is no blanket, CREATE or TRUNCATE grant.

Database and role names use matching random UUID suffixes. Cleanup revalidates
the generated pair and drops only resources created by that fixture. It drains
pools, attempts both database and role removal, and verifies their absence.
Repeated/concurrent disposal shares one operation, including its failure result.
Partial setup failures also run cleanup. Credentials stay in process memory;
setup/cleanup diagnostics do not include raw driver errors or connection URLs.

Every new tenant module must use this harness or equivalent reviewed tests.
Positive and negative A/B operations, repository/RLS mismatch, missing context,
WITH CHECK, rollback and concurrent pooled access must remain release-blocking
checks. A GUC assertion alone is insufficient: tests must inspect protected rows.
Fixture contexts do not replace future request authorization or permissions.

## Task 1.12: role-derived permission boundary

Role bundles are tenant-owned; labels confer no privilege. Composite foreign keys
enforce tenant consistency independently of RLS. ENABLE/FORCE RLS and explicit
church_id predicates apply to roles and both assignment tables. The production
tenant transaction guard checks all five protected tenant tables, including role
ownership/owner membership, superuser/BYPASSRLS/CREATEROLE and RLS enforcement.
Missing or mismatched context cannot reveal or mutate foreign authorization data.

Role-derived permission eligibility is centralized and fail-closed: member may
receive assigned permissions; inactive requires explicit inactiveEligible metadata;
follower and left always deny. Only members.view is currently inactive-eligible,
consistent with retained permitted directory access. It does not grant sensitive
profile fields or remove later object/privacy checks. events.create is not eligible.
Role management, membership management, administration, ownership and privileged
security operations are not registered or inactive-eligible. Unknown keys deny.

No permission cache exists. Membership status, assignment removal and role-permission
removal affect the next evaluation. Evaluation is not a promise of future access:
protected operations must recheck current entitlement within their own transaction.
No controllers expose assignment mutation; internal repository methods are not a
delegation check. The caller must resolve the subject's membership from authenticated
server identity. Driver failures become sanitized service errors, never an allow.

No password or social session alone satisfies privileged assurance. Task 1.7 remains
blocked; future protected capabilities require secure TOTP and the ADR 0003/Phase 1L
assurance gate, plus audit trails for administrative mutations. No ownership,
standard privileged roles, administration APIs or bypasses are activated here.

## Task 1.7a security boundary; Task 1.7b remains blocked

The isolated PostgreSQL/Drizzle probe reproduces Better Auth 1.7.4 issue #10387:
one currently valid code is accepted on two independent login challenges in the
same timestep. Native TOTP uses six digits, 30 seconds, SHA-1 and the utility's
one-step tolerance on either side; it does not consume an accepted timestep.
Native enrollment confirmation uses that same verifier. The application therefore
never invokes it: both TOTP and backup-code completion return a generic 503.
This is a disabled authentication path, not a replay workaround. No second-factor
assurance or privileged capability can be granted by Task 1.7a.

Native secret storage is symmetric encryption using the Better Auth secret.
`two_factor.backup_codes` contains an encrypted JSON array of ten random codes,
each ten alphanumeric characters displayed in `xxxxx-xxxxx` format. It is not a
hash: unused codes can be recovered with the ciphertext and authentication secret.
Secret/code retrieval APIs are omitted; only explicit setup/rotation disclose the
new material, with `Cache-Control: no-store`. Secrets, URIs, codes, passwords and
session tokens must not enter logs or ordinary JSON. Pending enrollment may be
replaced, invalidating old material; an already verified native record cannot be
replaced through enable.

The isolated native recovery probe proves one successful consumption across two
independent concurrent challenges. The losing request is 409 if its conditional
write loses, or 401 if it reads the already consumed list; subsequent reuse is
401. Consumption uses an atomic adapter compare-and-swap on the encrypted code
list. Rotation invalidates unused old codes without adding sessions. Recovery
login remains blocked in the application pending review; it is not automatically
activated merely because the native concurrency probe passes.

Native challenge records last ten minutes and have a five-attempt budget. Native
account protection defaults to ten failures and a 15-minute lock, with reset after
success/expired-lock handling. These native mechanisms do not fix TOTP replay and
are exercised only in the isolated verifier probes while production completion is
blocked. Native endpoint limits (three requests per ten seconds for two-factor
paths), trusted-origin and CSRF checks remain. Limiting is in-memory and is not a
distributed abuse-prevention system. Blocked requests can return 429 when limited.

Native disable requires password re-entry and a database-authoritative session;
it is not privileged step-up. Its cookie/session rotation is explicitly reported
and preserves original `createdAt`. Native multi-write enable/disable operations
are not one transaction; failures are surfaced and logged only through sanitized
auth diagnostics. No atomic-operation claim is made. No ownership or administrative
function becomes usable here. Native trusted-device bypass is prevented even for
an existing correctly signed trust cookie; no supported endpoint creates one.

Task 1.7b requires reviewed proof of durable, atomic one-use-per-timestep behavior
across independent challenges before enabling trusted verification. An approved
upstream fix or a separately approved application replay-guard design may satisfy
that requirement. Dependency upgrades must not silently activate this path.

## Task 1.13 standard-role safety boundary

The four non-privileged standard roles intentionally grant no permissions until
their required object/operational scopes exist. A system flag, stable role key or
display name is never MFA assurance or an authorization bypass. Task 1.7b stays
blocked; administrative and ownership capabilities remain inactive. The existing
permission registry, inactive-eligibility defaults and follower/left denial are
unchanged.

Explicit internal provisioning uses a trusted TenantContext, scoped queries, the
restricted runtime role and existing FORCE RLS/composite foreign keys. A scoped
church row lock serializes concurrent reconciliation; all four roles commit or
roll back together. Display-name collisions never convert a custom role. Exact
bundle reconciliation removes unauthorized mapping drift from canonical rows,
with the next uncached evaluation observing revocation. Custom roles remain
untouched. Errors expose only a generic provisioning failure or safe collision
code, without database details.

No HTTP mutation surface, automatic assignment or production seed is added. Later
role-management operations still require explicit authorization and audit design;
this internal provisioning capability must not be exposed to clients directly.

## Task 1.14 church verification security boundary

Church verification is metadata, not authorization. `verified` cannot grant a
membership, role, permission, session, ownership, MFA assurance or RLS exemption.
The four Task 1.13 system bundles remain empty and the Task 1.12 permission registry
is unchanged. Task 1.7b still blocks privileged assurance and activation.

The internal tenant-side request operation has a fixed `pending` destination. It
requires branded TenantContext, explicit church ID predicates, a transaction-local
RLS context and the restricted non-owner/NOBYPASSRLS runtime. It locks before
evaluating current state and updates conditionally; missing/mismatched scope cannot
change another church. Pending retries preserve updatedAt; invalid transitions
make no write. Ordinary church details updates cannot accept verificationState.

Only the pure transition policy represents platform approval/rejection/revocation
now. It does not authorize a caller or execute platform review. Cross-tenant review
persistence, platform authorization, required audit trail and review metadata are
deferred together; no production bypass or fake superadmin has been introduced.
The policy and test-only concurrency probe must not be mistaken for an activated
review workflow. No request/review HTTP API exists; future exposed actions require
reviewed entitlement and audit integration. Failures expose no driver diagnostics.
