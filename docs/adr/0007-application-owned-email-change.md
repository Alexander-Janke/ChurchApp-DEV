# ADR 0007: Application-Owned Email Change

## Status

Accepted

## Context

Task 1.6 reproduced a specific Better Auth 1.7.4 native change-email problem:
request two changes for one identity, complete the newer change, register a different
identity at the released original address, then redeem the older verification link.
The native handler resolves its signed email claim by current address ownership;
the probe changed the different identity and created a session for it. This decision
is scoped to that tested behavior and this project's identity-binding requirements;
it does not characterize Better Auth as globally insecure.

## Decision

Keep native `user.changeEmail.enabled=false` and
`updateEmailWithoutVerification=false`. Better Auth remains authoritative for users,
credential accounts, login and PostgreSQL-backed opaque sessions. The application
owns only a dedicated `email_change_request` workflow, exposed by a supported
Better Auth endpoint extension inside the Nest AuthModule. No native code is patched.

## Security properties

- Every request binds immutable user ID, original email snapshot, destination,
  initiating session ID, random request ID, state and absolute expiry.
- Current-address approval is mandatory, even for an unverified current address.
  New-address verification is separate; neither request nor approval changes email.
- Node generates independent 256-bit opaque tokens. Only SHA-256 hashes persist.
  Each phase consumes its hash once. SQL equality uses high-entropy hashes, not
  comparison of raw bearer secrets; tokens never enter response JSON or diagnostics.
- States are `pending_current_email`, `pending_new_email`, `completed`, `superseded`.
  The entire workflow expires at creation plus one hour (`expiresAt <= now` fails).
  Approval never extends the deadline.
- Latest successful request creation supersedes every previous incomplete request.
  A partial unique index permits only one active request per user, including expired
  incomplete rows until supersession. User-first row locks serialize all transitions.
- Redemption looks up a candidate by hash, then rechecks request/hash/state/expiry
  under locks against the immutable user ID and original email snapshot. Address
  reassignment never selects a different user.
- Final identity update, token consumption, completion state and own-session deletion
  share one Drizzle/PostgreSQL transaction. Destination availability is rechecked;
  the existing unique email constraint is the final concurrent-acquisition defense.
- Keep the initiating session only if it still belongs to the user and is valid under
  Task 1.4. Otherwise revoke all own sessions. Never create a session or restart its
  `createdAt`. Other users and credential/provider accounts are unchanged.
- The initiating session ID is a snapshot, deliberately without a session FK:
  logout must not delete the workflow. `userId` has a cascading FK to the user.
- All three routes require POST and an exact configured trusted Origin. Token
  possession authorizes redemption, not cookies or a supplied email/user ID. Links
  target fixed future frontend paths on the configured origin, with tokens in URL
  fragments. No client callback URL is accepted; GET never consumes a token.
- Application-specific router limits are 3 requests/minute for creation and 10/minute
  per redemption endpoint/source IP. Better Auth applies these to the extension;
  its existing production in-memory limiter remains single-instance. Deployment must
  establish trusted proxy/IP handling and shared limits before horizontal scaling.

## Delivery and failure semantics

The existing provider-neutral sender has explicit approval, new-address verification
and completion-notice message types. No configured delivery means request creation
fails before persistence. Required delivery is tracked and awaited inside its
transaction with a five-second timeout. Provider rejection/timeout rolls back
creation or phase-one consumption; the prior approval remains retryable. An email
accepted just before rollback, or delivered after timeout, can contain an invalid
link. It cannot bypass the database state. This deliberate small initial design
holds a row lock/connection during bounded delivery; production provider latency,
operation timeouts and an outbox deserve review before public deployment.

After commit, an informational notice is dispatched to the old address. Failure is
sanitized and cannot roll back or misreport the committed identity change. Pending
provider work drains on graceful shutdown. This is not crash-durable or exactly-once
mail delivery; providers must terminate outstanding I/O. No raw-token retry store or
custom cryptographic protocol is introduced.

## Rejected alternatives

Native Better Auth 1.7.4 changeEmail does not meet the tested invariant. Merely
checking current address ownership, retaining stateless old links, or patching the
library would not provide the required permanent user binding. A general workflow
engine or additional authentication/token library is unnecessary.

## Consequences and tests

The application owns one table and transaction-based workflow while retaining the
canonical generated Better Auth schema unchanged. Migration SQL creates only this
table, its FK, state check and unique indexes; no tenant field or RLS applies.

Real PostgreSQL tests permanently cover both stale approval and stale verification
links after latest-request supersession and original-address reassignment. They also
cover concurrency, exact expiry, failed delivery retry, session/account isolation,
destination acquisition races and clean/repeated migration. Broad recent-authentication,
privileged assurance and frontend work remain deferred; this task does not claim
implementation of ADR 0003's five-minute step-up mechanism.

## Future review

A future Better Auth version may justify reconsideration only after running the
attack regression against it, proving immutable-user binding or an equivalent
invariant, and explicitly superseding this ADR. Dependency upgrades must never
silently reactivate native changeEmail. Production mail/outbox, retention of completed
workflow metadata, trusted frontend callbacks and distributed abuse protection remain
separate follow-up decisions.
