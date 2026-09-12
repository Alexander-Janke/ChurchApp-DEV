# ADR 0004: Object Storage

## Status

Accepted

## Context

The Church Platform stores images, documents, attachments, and sermon audio for resources with different audiences and ownership models. Private communication and sensitive personal/child information require authorization independent of the storage location. The platform needs quotas, safe lifecycle handling, and portability from its initial netcup deployment.

This decision complements [ADR 0002](0002-database-access.md), [ADR 0003](0003-authentication-and-sessions.md), and [ADR 0006](0006-tenancy-and-authorization.md). It records storage architecture, not a final schema, provider purchase, bucket layout, or upload implementation.

## Decision

Use an application-owned storage abstraction with S3-compatible object storage. S3 is the protocol/API compatibility target; it does not require AWS hosting. Production storage should be EU-hosted and independent of the application container filesystem. Providers remain replaceable.

Objects are private by default; public delivery requires an explicit authorized publication decision. PostgreSQL is authoritative for file metadata and authorization relationships. Object keys and bucket paths are not authorization. Direct video upload is excluded from V1; sermon video uses external links such as YouTube. Sermon audio has a separate logical quota.

## Storage Abstraction

Business/application modules depend on an application-owned abstraction, not vendor SDKs. Conceptual operations include creating/uploading an object, reading/downloading it, deleting it, inspecting metadata where needed, and generating narrowly scoped temporary access where appropriate. The exact TypeScript interface is deferred.

Provider-specific SDKs and configuration belong in infrastructure/storage code behind that abstraction. Domain modules must not depend directly on AWS, netcup, Garage, MinIO, or another vendor. Keep application authorization in application services; calling a storage adapter must not itself imply permission to a resource. Avoid exporting an unrestricted signing operation to controllers.

Do not hard-code AWS-specific features into domain/application code. Verify the required subset of S3 operations, signing, checksums, metadata, and error behavior against each selected provider rather than assuming identical implementations.

## Metadata and Ownership

PostgreSQL holds authoritative application file metadata and resource relationships. Conceptual fields may include internal file ID, owning resource, church association when applicable, uploader, provider/bucket reference, object key, MIME type, size, checksum, lifecycle state, timestamps, and sensitivity classification. This is not the final schema.

Authorize using the metadata and the owning resource's current policy. Uploader identity alone is not necessarily ownership or permanent access. Client-declared metadata and object-store headers do not establish entitlement. Return only permitted metadata; original filenames and resource descriptions can themselves be sensitive.

Binary contents live in object storage. A valid database reference does not prove a completed, validated upload, and an object existing in a bucket does not make it an authorized application file.

## Object Key Design

Generate storage identities server-side, using non-guessable identifiers where appropriate. Avoid names, email addresses, medical details, prayer text, or other unnecessary personal information in keys and paths. Original filenames must not be the sole object identifier; retain them as protected display metadata where needed.

Keys should remain provider-neutral where practical. Tenant prefixes may help organization but do not enforce isolation. Neither obscurity nor possession of a key grants authorization. Reject attempts to substitute another resource's key or overwrite an existing object outside the authorized operation.

## Upload Flow

The conceptual flow is:

1. Authenticate the actor when required by the upload operation.
2. Authorize upload against the target resource, tenant/participant relationship, and context.
3. Validate declared metadata through accepted DTOs; reject protected ownership fields and unknown fields.
4. Enforce allowed size/type and applicable quota policy.
5. Generate the server-controlled storage identity/object key.
6. Upload through an approved mechanism into a non-usable pending state.
7. Verify actual object properties/content as required and finalize database metadata and quota accounting.
8. Make the file usable only after successful validation/finalization.

Finalization must verify the object belongs to that upload and recheck authorization/resource state where it may have changed. Do not trust MIME headers, declared sizes, or a client claim that upload succeeded. Preserve a validation/quarantine stage for malware scanning where required by file risk and SECURITY.md.

If direct-to-storage upload is introduced, the backend first authorizes and issues short-lived, narrowly scoped upload permission. The client cannot freely choose buckets, tenants, ownership, keys, or public access settings. Constrain operation, destination, and supported upload limits; verify actual results before activation. Prevent reuse of upload permission from overwriting already-finalized content, through a reviewed immutable-finalization or equivalent strategy.

Track abandoned/incomplete uploads and any quota reservations for bounded cleanup. Finalization and cleanup must be retry-safe and handle races without exposing or deleting valid files. No upload mechanism or queue is implemented by this ADR.

## Download Flow

Private access requires application authorization against current metadata/resource relationships. Use authenticated backend streaming or short-lived signed download URLs according to sensitivity and operational needs. Deny access to unavailable, unfinalized, or logically deleted files, and never fall back to public access when authorization/storage fails.

Signed URLs must be scoped to the intended object and operation, short-lived, and free of excessive personal information in path/query metadata. They are temporary bearer capabilities, not permanent permission or proof of the downloader's identity. Standard presigned links may be reused or forwarded within their validity; database/session revocation alone does not necessarily invalidate one already issued. See the [S3 presigned URL documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

Where current-user binding, immediate revocation, or current authorization on every access is required, use authenticated delivery rather than a bare reusable signed link. Expiry and invalidation behavior must be tested for the selected provider; no exact duration is selected here. Do not log signed URLs or expose them through unrelated resource responses.

## Sensitive Files

Sensitive child documents, medical/emergency information, and protected administrative records need tenant authorization where applicable, object/context authorization, current need-to-know, and sensitive-access logging where required. A generic `files.read` permission is insufficient by itself. Prefer current authorization through authenticated delivery for highly sensitive files.

Private prayer files follow the prayer audience policy; direct-message attachments follow participant authorization. Shared storage does not grant church or platform administrators access to private content. These examples do not add attachment features outside the product scope or advance child features ahead of their security foundation.

## Tenant Isolation

Tenant-owned metadata follows ADR 0006: trusted server-created context, explicitly scoped repositories, transaction-local PostgreSQL RLS, and constraints preventing incompatible cross-tenant references. RLS protects database access, not bucket contents directly; the application must authorize the object operation before using storage credentials.

A Church A actor must not gain access to Church B's protected files through changed URLs/tenant IDs, guessed keys, manipulated upload metadata, or substituting an object into another authorized resource. Signed grants must not permit operations on another key/resource or beyond their intended scope/lifetime. Where forwarding a signed grant would violate the required audience boundary, choose authenticated delivery as described above instead of claiming a bare URL is user-bound.

Global/private participant-owned files use the corresponding account/participant policies, not fake church IDs. Storage administration and quota visibility must not bypass file-content or sensitive-metadata authorization. Cleanup, search, and export paths inherit the same rules.

## Quotas

Support per-church general storage quota, a separate logical sermon-audio quota, plan-dependent limits, authorized administrative usage visibility, and cleanup/deletion workflows. Logical separation does not require separate buckets or providers.

Enforce quota before accepting/finalizing storage where practical. Account for concurrent uploads, pending reservations, retries, and actual validated sizes so parallel requests cannot exceed limits or double-count usage. Define release of abandoned/deleted storage accounting consistently with lifecycle handling. Exact Free/Basic/Pro sizes, treatment of shared/private non-tenant files, and detailed accounting rules are deferred.

Direct video uploads remain excluded from V1. A general file endpoint must not become a video-upload workaround. External sermon video links do not authorize hosting the video binary.

## Deletion and Retention

Logical application deletion and physical object removal may happen separately. Use lifecycle states where appropriate to stop normal access while physical deletion is pending. Check references before deleting shared/referenced content and provide the warnings required by PRODUCT.md.

Database transactions cannot atomically commit an object-store operation. Plan observable, retry-safe deletion and reconciliation for partial failures, orphaned objects, and missing objects; neither system should silently drift indefinitely. Background cleanup may remove expired or abandoned data when implemented, with explicit scope and authorization.

Eventually account for user deletion, the church deletion protection period, legal retention, backups, and audit requirements. Follow existing product periods without inventing new legal retention durations. Backup/restore procedures must reconcile metadata and object lifecycles and prevent deleted/private objects from accidentally returning to active public access.

## Local Development

Use an S3-compatible implementation when actual object-storage behavior is required. Garage is the preferred initial local-development candidate; adjust the final container/tooling choice if compatibility requires it. Application code must not call Garage-specific APIs. Its [S3 compatibility documentation](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/) is a starting point for later adapter verification, not proof of compatibility with every needed operation.

Use synthetic data and separate local credentials when implemented. Unit tests may use controlled adapter fakes, but real storage behavior requires integration/contract tests. This task creates no local service or Docker configuration.

## Production

Select replaceable S3-compatible storage hosted in the EU, private by default, encrypted in transit, and encrypted at rest where supported/appropriate. Verify data residency and backup arrangements during provider selection. Keep persistent uploads operationally independent of application containers; the netcup application server's local filesystem is not the primary production storage architecture.

Use narrowly scoped operational credentials and separate environment storage. Plan backups/recovery, access monitoring, and credential rotation. No production provider, account, bucket, or credentials are selected or created here.

## Alternatives Considered

### Application server filesystem

Simple and inexpensive initially, but couples persistence and backup/restore to the application host, limits horizontal scaling, and creates portability and operational risks. It is not selected as primary production storage. Temporary bounded processing files are a separate implementation concern, not an upload persistence strategy.

### Provider-specific object-storage integration

Can expose useful vendor features, but introduces unnecessary coupling when standard object operations suffice. Isolate any justified provider-specific behavior behind the application abstraction instead of spreading it into domain code.

### S3-compatible abstraction

Selected for portable object operations, separation of storage from application containers, and replaceable local/production implementations. Compatibility is a target, not a guarantee that all providers behave identically. Contract tests and provider review are part of implementation and migration.

## Security Considerations

Private defaults, least-privilege credentials, authorization before signing/streaming, validated finalization, quotas, and scoped cleanup are required together. Neither a bucket layout nor encryption replaces application authorization. Prevent unsafe public ACLs, path/key substitution, untrusted metadata, malicious content, and sensitive filenames/signatures entering logs.

Retain upload size/type limits, safe download headers, and file-risk controls under [SECURITY.md](../SECURITY.md). Public publication must be explicit. A storage outage must not produce a public fallback or a falsely finalized file.

## Testing Requirements

Add positive and negative tests with the first relevant file flows:

- Authorized and unauthorized uploads; wrong-tenant upload rejected.
- Authorized and unauthorized downloads; wrong-tenant and non-participant download rejected.
- Object-key/resource substitution and protected ownership fields rejected.
- Quota enforcement, including concurrent requests, separate sermon-audio accounting, and retry safety.
- Invalid declared/actual size/type and prohibited video uploads rejected.
- Incomplete upload cleanup, repeated finalization, and post-finalization overwrite attempts.
- Deleted-resource access denied; partial delete failures and reconciliation handled safely.
- Signed URL object/method scope and expiry where used; no claim of user binding without enforcing it.
- Sensitive-file/context policy, private prayer/DM attachment policy where implemented, and appropriate audit logging without leaked secrets.
- Storage-provider adapter contracts against actual S3-compatible implementations, including failure behavior.

Use real PostgreSQL/runtime-role integration tests for tenant-owned metadata/RLS and real storage contract tests where provider behavior matters. Follow [TESTING.md](../TESTING.md); tenant-isolation failures remain release-blocking. This ADR does not claim any storage integration has been tested yet.

## Consequences

The abstraction preserves provider portability and keeps privacy/business rules in the application while supporting EU hosting and separate audio accounting. Costs include operating two persistence systems, lifecycle reconciliation, quota concurrency, and provider compatibility testing. Keep the interface small and introduce mechanisms with actual file flows rather than building a general storage platform in advance.

## Future Review Triggers

Review for demonstrated compatibility gaps, unacceptable operational/cost constraints, changed residency/security requirements, or measured scale needs. A provider replacement should normally retain the abstraction and authorization model. New provider features alone do not justify domain coupling or weaker privacy defaults.
