# ADR 0005: Realtime

## Status

Accepted

## Context

Chat and selected live updates can benefit from bidirectional delivery to Flutter and Next.js clients. The platform begins as a NestJS modular monolith ([ADR 0001](0001-backend-framework.md)); it needs consistent authorization and graceful recovery without introducing distributed infrastructure prematurely.

Authentication/session policy follows [ADR 0003](0003-authentication-and-sessions.md). Tenant, object, and private-participant boundaries follow [ADR 0006](0006-tenancy-and-authorization.md). A realtime transport must preserve both.

## Decision

When realtime functionality is implemented, use Socket.IO through NestJS gateways in the same modular backend/codebase. Do not create a separate realtime microservice initially. REST/API and PostgreSQL remain authoritative for durable state and history.

Redis is not initially required for realtime. Introduce a cross-instance adapter only when horizontal realtime scaling needs it; the expected initial path is the Socket.IO Redis adapter. This decision installs no dependencies and implements no gateways, chat, Redis, or queues.

Use realtime only where it materially improves documented product behavior: likely chat, selected live feed/event/duty updates, or notification delivery hints. Presence requires a justified product/privacy need and is not added to V1 scope by this record. Availability of sockets alone is not a reason to build a feature.

## Realtime Boundary

Gateways translate validated transport messages into application calls and filtered responses. They reuse the same application/domain business and authorization policies as normal API operations. Do not build independent REST and WebSocket authorization systems. Connection-specific checks are allowed, but business permission decisions remain application-owned.

Do not expose Socket.IO room objects or adapter state as domain authority. Any future socket command that changes durable state must call the same authorized use case and repository/transaction rules as REST, not mutate state only in gateway memory. Private response filtering also applies to outbound events and acknowledgements.

## Durable State

PostgreSQL stores durable business state/history, accessible through the normal REST/API. Realtime is primarily delivery, notification, and synchronization signaling. A room is not the source of truth for membership, permissions, chat history, event state, duty assignments, notifications, or other durable data.

Persist successful changes before emitting notifications about them. An emission or socket acknowledgement is not proof of database commit unless the application explicitly ties its response to a completed use case. Avoid exactly-once delivery assumptions. Clients recover authoritative state through the API after reconnecting, using identifiers/versions or cursors where needed; replayed hints must not duplicate durable effects.

## Connection Authentication

Authenticate connections securely when the requested resource requires it, using the application AuthModule and authoritative server-side sessions. Derive the actor from the validated session, not a client-supplied user ID, church ID, role name, or room name. A Socket.IO connection/session identifier is not an application login session.

Browser transport must preserve ADR 0003's HttpOnly cookie boundary and origin protections. Flutter uses its securely stored opaque credential through a supported protected handshake mechanism; never place reusable credentials in URLs or logs. Validate actual browser/mobile client compatibility during implementation instead of exposing browser bearer credentials for convenience.

An authenticated connection does not grant access to all resources. Explicitly public subscriptions, if introduced, require only public-resource policy and must not accidentally expose internal events or require blanket membership. Reconnect must re-establish valid identity/authorization.

## Subscription Authorization

Before subscribing to a protected resource:

1. Authenticate the actor and verify required session assurance.
2. Identify the requested resource.
3. Resolve tenant/relationship where applicable.
4. Evaluate effective permissions.
5. Evaluate object/context authorization and privacy.
6. Derive server-controlled room/subscription membership.

Knowing an identifier never allows arbitrary room joins. Church membership does not grant every tenant room. Church administrators do not automatically join private direct-message conversations. Private group chat requires group/object access; private prayer content must not be broadcast through a general church channel.

Authorize recipient selection and payload fields before emitting. Do not send broad private data and rely on client filtering. Even IDs, titles, unread counts, and notification hints can leak protected information. A room is a delivery optimization whose members must still satisfy current policy.

## Tenant and Object Isolation

ADR 0006 applies to subscription decisions, emitted events, mutations, reconnects, and background delivery. Tenant-specific database reads/writes use trusted context, explicit repository scoping, RLS, and constraints as elsewhere; RLS does not filter already-loaded socket payloads.

Server-derived names must prevent collisions between tenant/object scopes, but prefixes alone are not authorization. Church A must not subscribe to Church B's protected resources or receive its events through room manipulation or misrouted broadcasts. Private participant-owned conversations remain participant-authorized without synthetic church IDs. No frontend filtering or administrative rank bypass is permitted.

## Revocation

Respond to session revocation/expiry, church removal, group removal, privileged-permission revocation, blocking under the relevant resource policy, and account disabling. Disconnect affected connections or remove subscriptions as required. Expired elevated assurance must stop protected privileged operations even if a normal session remains valid.

Connection-time authorization is not a permanent grant. Re-evaluate sensitive actions at action time and ensure sensitive delivery uses current authorization. Define coordinated invalidation and final authorization checks during implementation so stale room membership cannot authorize delivery after revocation. Do not invent an allowed stale-permission window without explicit security review.

Missed revocation notifications or reconnect restoration must not revive removed subscriptions. Fail closed for protected actions/delivery when current entitlement cannot be established. Data already legitimately delivered cannot be recalled; future access and delivery must reflect current policy.

## Scaling

Initially one backend instance hosts realtime. When multiple backend instances serve the same realtime namespace, add suitable cross-instance coordination, initially expected to be the Socket.IO Redis adapter. This is a future mechanism, not a Phase 0 dependency.

At that point verify proxy configuration, transport choice, session affinity where required by HTTP long-polling, cross-instance subscription removal, and failure behavior. An adapter distributes events; it does not make PostgreSQL sessions, permissions, or history optional. Test actual NestJS/Socket.IO/Flutter client versions and adapter capabilities before enabling scaling.

## Redis

Do not add Redis solely because Socket.IO supports it. Concrete later reasons may include horizontal realtime scaling, BullMQ/background jobs if separately selected, distributed rate limiting, or another justified coordination need. This ADR does not select a queue implementation.

Do not initially use Redis as an authorization cache, private-data cache, or session source of truth. PostgreSQL-backed sessions remain authoritative under ADR 0003. If an adapter is later introduced, protect its internal channels and credentials; shared broker access is a security-sensitive infrastructure boundary, not a user authorization mechanism.

The standard Redis adapter forwards packets through Pub/Sub and is not durable event history. Its recovery and outage characteristics require verification; do not assume missed packets will be replayed automatically. See the [Socket.IO Redis adapter documentation](https://socket.io/docs/v4/redis-adapter/).

## Background Jobs

Background processing and realtime delivery are separate concerns. A job may persist a durable change and then request an authorized realtime notification. An emission must not be treated as proof that processing or a transaction succeeded. Jobs retain the same tenant/context and current-authorization requirements as application calls.

If reliable delivery from database changes to events becomes necessary, evaluate a transactional outbox with retry-safe consumers. Until then, clients recover durable state through the API and must tolerate missing hints. This record does not implement an outbox, queue, worker, or broker.

## Failure Behavior

When sockets are unavailable, ordinary durable API reads/writes should continue where practical. Reconnect safely with bounded retry/backoff and refresh authoritative state. Missing, duplicated, or out-of-order events must not permanently corrupt state; consumers should deduplicate or refresh using durable identifiers/versions where relevant.

Do not require realtime connectivity for ordinary durable operations without a separately justified feature requirement. Distinguish failed delivery from failed persistence so retries do not duplicate changes. Surface connection degradation appropriately without logging private payloads. Broker failure must not trigger unsafe broadcast or relaxed authorization.

## Alternatives Considered

### Raw WebSockets

Provide lower-level control and less protocol abstraction. Socket.IO's connection, reconnection, and room abstractions better fit the expected product needs, reducing transport work. These conveniences do not supply application authorization or durable delivery guarantees.

### Server-Sent Events

SSE is simpler for server-to-client updates. It is not the general choice because future chat and other bidirectional interactions benefit from bidirectional realtime communication. A narrowly scoped future SSE use case may still be justified without creating a second business/security model.

### Separate realtime microservice

Not selected: current scale does not justify the operational complexity and risk of duplicating application/security boundaries. Retain module boundaries so later separation can be evaluated if measured needs warrant it.

## Security Considerations

Validate event names, payload DTOs, sizes, and subscription limits; rate-limit abusive connections/actions. Require encrypted transport and appropriate browser Origin checks to prevent cross-site socket hijacking. CORS settings alone are not a complete WebSocket origin/authentication control. Do not trust client identity, role, tenant, or room claims.

Keep credentials, private messages, prayer content, and sensitive child data out of diagnostic logs and broad broadcasts. Apply the same assurance, privacy, and field filtering as REST. No gateway decorator, successful handshake, or Redis adapter replaces application authorization. Define these checks before exposing the first protected realtime feature.

## Testing Requirements

Security-negative tests are mandatory and tenant-isolation tests are release-critical. With the first relevant realtime flows, test:

- Valid authenticated connection; invalid, expired, revoked, and disabled-account sessions rejected.
- Authorized subscriptions; unauthorized, wrong-tenant, and private-object subscriptions denied.
- User/role/tenant/room manipulation cannot expand access; private participant resources remain isolated.
- Cross-tenant events and sensitive fields never reach unauthorized recipients.
- Permission, membership, session, and group revocation remove access; applicable blocks and assurance expiry are enforced.
- Reconnect reauthorizes and restores state through the API without reviving removed subscriptions.
- Missing, duplicate, and out-of-order events are tolerated where relevant.
- Ordinary durable functionality works gracefully when realtime is unavailable.
- Origin/credential handling, invalid payloads, abuse limits, and absence of secrets from logs.
- Multi-instance routing, revocation propagation, affinity, and broker outages when Redis scaling is introduced.

Test actual gateway/client integration as well as shared service policies. Use real PostgreSQL where session/isolation behavior matters. Do not defer first-feature security tests until the later scaling phase. Follow [TESTING.md](../TESTING.md); no realtime compatibility or runtime behavior is claimed tested by this documentation task.

## Consequences

Socket.IO/NestJS provides a consistent delivery mechanism within the modular monolith while REST/PostgreSQL preserves recoverable state. One authorization model reduces divergence between transports. Initial operations remain simple without Redis or a separate service.

Costs include connection lifecycle handling, client/protocol compatibility, privacy-safe fan-out, revocation coordination, and reconnect reconciliation. Keep payloads minimal and gateways thin, introduce realtime only with a concrete feature, and test shared authorization plus transport-specific failures. Socket transport convenience is not a substitute for durable processing.

## Future Review Triggers

Review for measured connection/fan-out limits, unavoidable multi-instance requirements, unsupported client compatibility, serious maintenance/security issues, or fundamentally changed communication needs. Adapter introduction must preserve session, authorization, and recovery guarantees. Do not separate services or add Redis merely for hypothetical scale.
