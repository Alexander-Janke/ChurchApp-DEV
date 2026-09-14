# Church Platform – Roles and Permissions Specification

## 1. Purpose

This document defines the role and permission model for the Church Platform.

The goal is to provide:

- clear authorization rules
- least-privilege access
- tenant-specific permissions
- understandable role management
- safe delegation
- flexible church organization
- consistent behavior across mobile, web, backend, search, files, realtime features, and background jobs

This document defines who may access or manage which resources.

Security rules are additionally defined in:

`docs/SECURITY.md`

---

# 2. Authorization Model

Authorization must be enforced server-side.

Every protected operation must determine:

1. Who is the authenticated user?
2. Which tenant/church is involved?
3. What relationship does the user have to the church?
4. Which roles does the user have?
5. Which permissions are granted?
6. Does object-level authorization apply?
7. Does the requested data contain sensitive information?
8. Does the current session satisfy the capability's required 2FA, elevation, and recent-authentication assurance?

Frontend permission checks improve usability but are not security boundaries.

Apply only the relevant stages to each resource: public church content needs no membership, following requires authentication, and follower/member/object/administrative access follows its own policy. Non-tenant resources use ownership, participant, or platform policies. [ADR 0006](adr/0006-tenancy-and-authorization.md) defines these access classes and the application-authorization-plus-RLS boundary.

---

# 3. Permission Philosophy

Use permissions rather than hardcoding business logic around role names.

Example:

Do not write:

“If user is Church Admin, allow event editing.”

Prefer:

“Allow event editing if user has `events.manage`.”

Roles are bundles of permissions.

Protected permission/capability metadata must specify assurance requirements that custom roles cannot weaken. Primary Owner, Main Church Administrator, Platform Superadmin, and any custom role with protected privileged capabilities require 2FA. Google/Apple login alone cannot bypass this requirement. Apply [ADR 0003](adr/0003-authentication-and-sessions.md) before activating privileges and on each protected operation, including safe factor-disable/recovery transitions. Member remains a relationship state, not an administrative role.

This allows churches to create custom roles later.

---

# 4. Additive Permissions

Permissions are generally additive.

If a user receives the same permission from multiple roles, the permission remains granted.

Example:

A person may be:

- youth leader
- musician
- event administrator

The resulting permission set is the combination of applicable permissions.

Do not introduce complex deny-overrides in V1 unless explicitly required.

---

# 5. Default Deny

If permission cannot be determined, access must be denied.

Unknown roles, missing permissions, invalid tenant relationships, or ambiguous authorization must fail closed.

---

# 6. Tenant Scope

Church permissions apply only inside the relevant tenant.

Example:

A user may be:

- Main Admin in Church A
- Member in Church B

The administrative permissions from Church A must not apply to Church B.

---

# 7. Platform Scope vs Church Scope

There are two main authorization scopes:

## Platform Scope

Examples:

- user account
- friendships
- personal profile
- personal notification settings
- personal Bible notes
- global superadmin functions

## Church Scope

Examples:

- members
- groups
- church events
- duties
- church feed
- church files
- church settings

Never automatically apply church-scoped permissions globally.

---

# 8. Base Relationship Types

A person may have one of these base relationships with a church:

- Follower
- Member
- Inactive Member
- Left Church

These are relationship states, not administrative roles.

Administrative roles are assigned separately.

---

# 9. Platform User

Every registered person is a platform user.

Basic platform permissions include:

- manage own account
- manage own profile
- manage own privacy settings
- manage own sessions
- manage own notification settings
- send contact requests
- manage accepted contacts
- use personal Bible features
- manage own church relationships

These permissions do not grant access to private church information.

---

# 10. Visitor

A visitor is not authenticated.

Visitor access may include only explicitly public content.

Examples:

- public church pages
- public service times
- public sermons
- public events
- public help offers
- public church discovery

Visitors must never access internal church content.

---

# 11. Follower

A follower is a registered user who follows a church.

Possible follower permissions:

- view follower-targeted posts
- view follower-targeted events
- receive follower notifications
- view follower-accessible sermons
- request church membership

Follower status does not grant:

- member directory access
- internal group access
- internal prayer access
- duty planning access
- member administration

---

# 12. Member

A confirmed active member may access general member functions.

Typical member permissions may include:

- view internal church feed
- view permitted member directory information
- view member events
- join eligible groups
- participate in group communication
- view permitted prayer requests
- access church sermons/resources
- view own duties
- respond to duty requests
- create content where explicitly permitted

Membership alone does not provide administrative permissions.

---

# 13. Inactive Member

Inactive members remain members but may have reduced operational participation.

They may normally retain:

- member content access
- member directory access
- group access where still assigned

They should normally not be selected automatically for volunteer planning.

Inactive status does not automatically remove all permissions.

Church-specific rules may adjust access.

---

# 14. Left Church

A person with status “Left Church” loses active internal church access unless another valid relationship exists.

Historical records remain.

Leaving must normally remove:

- active group memberships
- service planning eligibility
- internal member permissions

The account itself remains a platform account.

---

# 15. Standard Role Bundles

The platform should provide useful standard roles.

Suggested initial roles:

- Group Leader
- Area Leader
- Event Administrator
- Children’s Worker
- Main Church Administrator
- Primary Owner
- Platform Superadmin

Churches may later create custom roles.

Member capabilities derive from the church relationship, not a manually assigned administrative role. Primary Owner is a protected ownership relationship/capability, and Platform Superadmin is platform-scoped; neither is an ordinary custom church role.

---

# 16. Custom Roles

Church administrators may create custom church roles if they have permission to manage roles.

Example roles:

- Youth Leader
- Worship Leader
- Media Leader
- Secretary
- Treasurer
- Pastoral Care
- Children’s Ministry Leader

Custom roles are permission bundles.

Avoid unlimited complexity in V1.

---

# 17. Permission Naming

Use explicit permission identifiers.

Recommended style:

```text
resource.action
```

Examples:

```text
members.view
members.manage
events.view
events.create
events.manage
groups.manage
duties.plan
roles.manage
church.settings.manage
```

For sensitive functions, use more specific permission names.

---

# 18. Permission Categories

Recommended permission groups:

- Church
- Members
- Roles
- Groups
- Areas
- Events
- Duties
- Feed
- Prayer
- Sermons
- Files
- Tasks
- Children
- Needs/Help
- Storage
- Audit
- Billing
- Verification
- Platform Administration

---

# 19. Church Permissions

Suggested church-level permissions:

```text
church.view
church.profile.manage
church.settings.manage
church.public_page.manage
church.delete
church.owner.transfer
```

`church.delete` and `church.owner.transfer` are highly privileged.

In V1, church deletion is Primary-Owner-only and cannot be delegated to ordinary custom roles. Ownership transfer requires the protected ownership capability, mandatory 2FA, recent step-up authentication, an audit event, and transactional preservation of exactly one owner.

---

# 20. Member Permissions

Suggested permissions:

```text
members.view
members.view_private_profile
members.create
members.manage
members.change_status
members.remove
members.export
members.view_admin_notes
members.manage_admin_notes
members.manage_custom_fields
```

Sensitive fields may require additional permissions.

---

# 21. Sensitive Member Permissions

Do not use a single broad permission for all sensitive data.

Examples:

```text
members.view_address
members.view_phone
members.view_birthday
members.view_sensitive_internal_data
```

The exact implementation may group certain fields where practical.

Least privilege remains the goal.

---

# 22. Role Management Permissions

Suggested permissions:

```text
roles.view
roles.manage
roles.assign
```

Role assignment must respect privilege boundaries.

A user must not be able to assign a role containing permissions they are not allowed to delegate.

---

# 23. Privilege Delegation Rule

A user must never be able to create or assign permissions above their own delegation authority.

Example:

An Area Leader must not be able to create a custom role containing:

```text
church.owner.transfer
```

Role management itself must therefore validate the permissions being delegated.

---

# 24. Primary Owner

Each church has exactly one Primary Owner.

The Primary Owner has the highest church-level authority.

Typical capabilities:

- full church configuration
- main administrator management
- role management
- plan/billing administration where enabled
- ownership transfer
- church deletion request

Primary Owner status must not bypass platform security restrictions.

---

# 25. Primary Owner Protection

Only the current Primary Owner may normally transfer ownership.

Normal administrators must not be able to:

- remove the Primary Owner
- demote the Primary Owner
- replace the Primary Owner
- transfer ownership without authorization

Emergency recovery by platform support follows separate security procedures.

---

# 26. Main Church Administrator

Main Church Administrators have broad church management permissions.

Typical permissions:

- member administration
- groups
- events
- areas
- duties
- church settings
- public page
- storage
- templates
- role administration where allowed

They must not automatically have:

- ownership transfer
- unrestricted platform administration
- private message access
- private Bible note access

---

# 27. Group Leader

A Group Leader manages one or more specific groups.

Typical permissions within assigned groups:

```text
group.view
group.members.view
group.members.manage
group.posts.create
group.posts.manage
group.events.manage
group.files.manage
group.prayer.manage
group.learning.manage
```

These permissions apply only to assigned groups.

A Group Leader must not automatically receive access to all church groups.

---

# 28. Group Context Authorization

Group access requires both:

- permission
- relationship to the specific group or valid administrative scope

Example:

A leader of Group A must not automatically manage Group B.

---

# 29. Area Leader

An Area Leader manages one or more ministry/service areas.

Typical permissions:

```text
areas.view
areas.manage_assigned
areas.members.manage
areas.skills.confirm
duties.view
duties.plan
duties.assign
duties.manage_assigned_area
```

These permissions apply only to assigned areas unless the user has broader rights.

---

# 30. Skills Permissions

Members may declare their own skills.

Suggested permissions:

```text
skills.declare_own
skills.view_own
```

Area leaders may confirm skills in their responsible areas.

Suggested permission:

```text
skills.confirm
```

A leader should not necessarily confirm skills for unrelated areas.

---

# 31. Event Administrator

Event administrators have object-scoped permissions.

Typical event permissions:

```text
events.view
events.registrations.view
events.registrations.manage
events.waitlist.manage
events.payment_status.manage
events.checkin.manage
```

These permissions apply only to assigned events.

Event administrators do not automatically receive church-wide event management.

---

# 32. Event Creation Permissions

Suggested permissions:

```text
events.create
events.manage
events.delete
events.templates.manage
```

Churches may delegate event creation without granting all other administrative rights.

---

# 33. Registration Permissions

Normal users may manage their own event registrations.

Examples:

```text
registrations.create_own
registrations.view_own
registrations.cancel_own
```

Parents may manage registrations for linked child profiles when authorized.

---

# 34. Child Profile Permissions

Parents/guardians have permissions over linked child profiles.

Possible permissions:

```text
children.view_own
children.manage_own
children.register_for_event
```

Church workers require explicit operational permissions.

---

# 35. Children’s Worker

A children’s worker may access child data only when necessary for their assigned context.

Possible permissions:

```text
children.event_roster.view
children.checkin.manage
children.pickup.view
children.pickup.manage
children.emergency_contact.view
children.medical_info.view
```

Not every children’s worker requires every sensitive permission.

---

# 36. Medical Information Permission

Access to medical/allergy information must use a specific permission.

Example:

```text
children.medical_info.view
```

This permission should be granted only where operationally necessary.

Permission alone is insufficient: access also requires valid operational context, current need-to-know, and appropriate audit logging, including for administrators and the Primary Owner.

---

# 37. Pickup Permissions

Suggested permissions:

```text
children.pickup.view
children.pickup.manage
```

Only authorized workers should access pickup authorization.

---

# 38. Feed Permissions

Suggested permissions:

```text
feed.view
feed.create
feed.manage_own
feed.manage_all
feed.publish_important
feed.target_audiences
```

A normal member may have permission to post without permission to publish church-wide important announcements.

---

# 39. Announcement Permissions

Important announcements should require stronger permissions.

Examples:

```text
announcements.create
announcements.require_confirmation
announcements.view_confirmation_status
```

Not every content creator should automatically have these permissions.

---

# 40. Prayer Permissions

Suggested permissions:

```text
prayer.create
prayer.view_authorized
prayer.manage_own
prayer.moderate
```

Audience access remains mandatory.

A permission such as `prayer.moderate` does not automatically permit reading fully private prayer requests.

---

# 41. Prayer Audience Authorization

Permission and audience must both be valid.

Example:

A group leader may moderate prayer content in a group, but must not access:

- private user-only requests
- another protected group's requests

unless explicitly authorized.

---

# 42. Sermon Permissions

Suggested permissions:

```text
sermons.view
sermons.create
sermons.manage
sermons.delete
sermons.series.manage
sermons.files.manage
```

Public sermons may be viewed without authentication if explicitly public.

---

# 43. Duty Permissions

Suggested permissions:

```text
duties.view_own
duties.respond_own
duties.request_replacement
duties.view_area
duties.plan
duties.assign
duties.manage
duties.auto_plan
```

`duties.auto_plan` generates drafts only.

It does not grant automatic publishing beyond the user's existing duty permissions.

---

# 44. Duty Visibility

Normal members should generally see:

- their own duties
- relevant open opportunities

They should not automatically see confidential planning notes or all internal volunteer statistics.

---

# 45. Absence Permissions

Members may manage their own availability.

Suggested permissions:

```text
availability.view_own
availability.manage_own
```

Authorized planners may view relevant availability information.

Example:

```text
availability.view_for_planning
```

Optional absence reasons may require restricted visibility.

---

# 46. Need/Help Permissions

Suggested permissions:

```text
needs.view
needs.create
needs.manage
needs.commit_own
needs.commitments.view
```

The visibility of a need remains controlled separately.

---

# 47. Task Permissions

Suggested permissions:

```text
tasks.view_own
tasks.update_assigned
tasks.create
tasks.manage
```

A church task manager may assign tasks only inside the relevant tenant.

---

# 48. File Permissions

Files inherit authorization from their context where possible.

Examples:

A group file requires group access.

An event attachment requires event access.

A task attachment requires task access.

Avoid creating unrelated generic file permissions that bypass context.

PostgreSQL metadata/resource relationships determine file access under [ADR 0004](adr/0004-object-storage.md). Neither shared storage, object keys, nor storage-administration rights grant private prayer or direct-message attachment access; sensitive files retain their contextual need-to-know requirements.

---

# 49. Storage Administration

Suggested permissions:

```text
storage.view_usage
storage.manage
storage.delete_files
```

Deleting referenced files should require sufficient authorization and warning.

---

# 50. Search Permissions

Search does not create new permissions.

A result appears only if the user could otherwise access the underlying resource.

Example:

Search permission must never reveal hidden group names if the user cannot see that group.

---

# 51. Chat Permissions

Users may manage their own conversations.

Chat permissions depend on conversation participation.

There is no church administrator permission such as:

```text
chat.read_all
```

in V1.

Normal administrators must not browse private conversations.

---

# 52. Direct Message Access

Direct messages require:

- authenticated user
- valid conversation membership

A user's general church role does not grant access to another user's private messages.

---

# 53. Group Chat Access

Group chat requires valid group access.

When a person leaves a group, future access must reflect the current group access rules.

Historical access behavior should be defined consistently during implementation.

---

# 54. Audit Permissions

Suggested permissions:

```text
audit.view_church
audit.view_sensitive
```

Normal church administrators should see appropriate church audit events.

Platform audit events are separate.

Sensitive audit information may require stronger permissions.

---

# 55. Export Permissions

Exports require explicit permission.

Examples:

```text
members.export
events.export
church.export
```

Do not treat “can view” as equivalent to “can export everything.”

Large exports increase privacy risk.

---

# 56. Public Page Permissions

Suggested permissions:

```text
public_page.view_preview
public_page.manage
public_page.publish
```

Publishing may be separated from editing if needed.

---

# 57. Church Discovery Permissions

Public church discovery is not an administrative permission.

Church visibility depends on:

- church public status
- verification/state
- public page configuration

Internal data must not appear in discovery.

---

# 58. Billing and Plan Permissions

Suggested permissions:

```text
billing.view
billing.manage
```

Initially these may be limited to:

- Primary Owner
- specifically authorized administrators

Payment provider integration remains outside initial V1 scope.

---

# 59. Church Verification Permissions

Platform-level permissions:

```text
verification.view
verification.manage
```

These belong to authorized platform staff/superadmins.

Church administrators cannot approve their own verification.

---

# 60. Platform Superadmin

Platform superadmins operate outside individual church roles.

Possible platform permissions:

```text
platform.churches.view
platform.churches.manage
platform.verification.manage
platform.plans.manage
platform.support.manage
platform.templates.manage
platform.audit.view
platform.users.support
```

Platform permission does not automatically mean private content access.

---

# 61. Superadmin Restrictions

Even a superadmin must not automatically access:

- private direct messages
- private prayer requests
- personal Bible notes
- child medical data without justified support/security process

Do not implement a universal “see all data” permission.

---

# 62. Support Access

If support tooling later requires temporary access to a church context, use explicit support access.

Future support access should preferably be:

- time-limited
- purpose-specific
- audit logged
- visible where appropriate

Do not silently impersonate users.

---

# 63. Impersonation

General unrestricted user impersonation should not be part of V1.

If introduced later for support, it requires:

- explicit authorization
- strong audit logging
- clear visual indication
- time limitation
- security review

---

# 64. Permission Bundles

Standard role bundles should be defined centrally.

Example conceptual structure:

```text
Member
  → basic member permissions

Group Leader
  → Member
  + assigned group management

Area Leader
  → Member
  + assigned area management
  + duty planning

Main Admin
  → broad church administration

Primary Owner
  → Main Admin
  + ownership and critical church authority
```

Implementation does not need actual inheritance if explicit permission bundles are clearer.

Here, Member denotes capabilities derived from the current relationship, not an assignable role or automatic membership granted by a leadership role. Primary Owner denotes a protected capability, not a delegable custom-role bundle.

---

# 65. Permission Scope Types

Permissions may have different scopes.

Recommended conceptual scopes:

- own
- assigned object
- assigned group
- assigned area
- tenant
- platform

Examples:

```text
tasks.view_own
groups.manage_assigned
duties.manage_assigned_area
members.manage
platform.churches.manage
```

Avoid ambiguous permissions such as:

```text
manage_everything
```

---

# 66. Object-Level Authorization

Some permissions require object-level validation.

Examples:

- event administrator → only assigned event
- group leader → only assigned group
- area leader → only assigned area
- parent → only linked children

Possessing a general role is not sufficient.

---

# 67. Permission-Aware UI

The frontend must use permissions to decide which features to show.

If a user lacks access to a module, hide it where appropriate.

Prefer:

- hiding inaccessible navigation items

over:

- showing many disabled controls

Backend security remains mandatory regardless of UI behavior.

---

# 68. Permission-Aware Navigation

Examples:

A normal member should not see:

- Role Administration
- Church Settings
- Member Administration

A Group Leader may see:

- My Groups
- Group Administration

but not unrelated church administration.

---

# 69. Permission-Aware Search

Global search must apply authorization before delivering results.

Permissions must be considered for:

- result visibility
- snippets
- metadata
- linked resources

Do not expose restricted titles or names through search suggestions.

---

# 70. Permission-Aware Notifications

A notification must not give a user access to content they cannot open.

Before sending sensitive notifications, ensure the recipient is authorized.

If access is revoked later, opening the notification must re-check current permissions.

---

# 71. Permission-Aware Realtime

Realtime subscriptions require current authorization.

NestJS/Socket.IO gateways reuse the same application permission/resource policies as REST. Room identifiers are not grants, and membership in a church does not authorize every tenant/private-object channel. See [ADR 0005](adr/0005-realtime.md).

Examples:

- group chat
- event updates
- church feeds

If permission is revoked, the user must not indefinitely remain subscribed.

---

# 72. Permission-Aware Background Jobs

Background workers must not bypass permission boundaries.

Example:

A notification fan-out job must select only eligible recipients.

Do not assume that because a job runs internally, authorization no longer matters.

---

# 73. Role Changes

Role changes should take effect promptly.

When a role is removed:

- future API access must be denied
- realtime access should update
- cached authorization should expire or be invalidated
- affected privileged elevation/step-up state must be invalidated as appropriate; current capability authorization must be re-evaluated

---

# 74. Membership Removal

When a person leaves or is removed from a church:

Remove active access to:

- internal church feed
- member directory
- church groups
- duties
- internal files
- internal prayer requests

unless another explicit valid relationship still grants access.

---

# 75. Group Removal

When a user is removed from a private group:

They must lose current access to:

- group content
- group files
- future group messages
- group prayer requests

Historical behavior for previously received messages should follow the chosen product design and be documented.

---

# 76. Permission Auditing

Security-sensitive permission actions must be audited.

Examples:

- role created
- role edited
- role deleted
- role assigned
- role removed
- administrator granted
- administrator removed
- Primary Owner changed
- sensitive permission granted

---

# 77. Role Deletion

A role in active use must not be deleted without handling assignments.

Options may include:

- block deletion
- require reassignment
- explicit removal from affected users

Avoid silently leaving invalid permission state.

---

# 78. Protected Roles

Certain roles are protected.

Examples:

- Primary Owner
- Platform Superadmin

These must not be editable like normal custom church roles.

---

# 79. Standard Roles

Platform-provided standard roles may be:

- protected from deletion
- customizable only within safe boundaries

Church-specific custom roles may be fully managed according to permission rules.

---

# 80. Role Assignment UX

Role management UI should clearly show:

- role name
- description
- included permissions
- scope
- number of assigned users

Sensitive permissions should be visually identified.

---

# 81. Permission Grouping UX

Permissions should be grouped logically.

Example:

```text
Members
  [ ] View members
  [ ] Manage members
  [ ] Export members
  [ ] View administrative notes

Events
  [ ] Create events
  [ ] Manage events
  [ ] Manage registrations
```

Avoid presenting administrators with hundreds of unstructured technical permission names.

---

# 82. Dangerous Permissions

Highly sensitive permissions should show warnings.

Examples:

- manage roles
- export all member data
- transfer ownership
- delete church
- view sensitive child data

The UI should communicate consequences.

---

# 83. Permission Presets

When creating a custom role, the UI may offer templates.

Examples:

- Group Leader
- Area Leader
- Event Administrator
- Secretary

The administrator may adjust permitted options where safe.

---

# 84. No Role Explosion

Do not require a separate role for every minor responsibility.

Use:

- roles for reusable permission bundles
- object assignments for context-specific responsibility

Example:

Do not create:

“Event Admin – Summer Camp 2027”

as a permanent global role.

Instead assign Event Administrator context to that specific event.

---

# 85. Temporary Permissions

Architecture should allow future temporary permissions.

Example:

Temporary event administrator.

This does not need advanced scheduling in V1 unless required, but permission assignments should not be designed in a way that makes expiry impossible later.

---

# 86. Cross-Church Roles

Roles belong to one church.

A role assignment in Church A cannot be reused as permission in Church B.

The same person may have different roles in each church.

---

# 87. Platform Friends

Friend/contact relationships are platform-wide.

Church administrators have no permission to manage users' private friendship relationships.

---

# 88. Personal Privacy Settings

Users manage their own privacy settings.

Church roles do not automatically allow administrators to change a user's platform privacy settings.

Church administrative visibility may be separately defined for required internal member data.

---

# 89. Administrative Visibility vs Public Visibility

These must remain separate.

Example:

A member hides their phone number from other members.

Authorized church administration may still need the phone number for legitimate church administration if the product model allows it.

Do not use one single “visible” boolean for all contexts.

---

# 90. Custom Member Fields

Churches may create custom member fields.

Each custom field should support an access classification.

Possible concepts:

- member-visible
- admin-only
- sensitive admin-only

Do not automatically expose every custom field in member directory APIs.

---

# 91. Administrative Notes

Administrative notes require explicit permission.

Suggested permissions:

```text
members.view_admin_notes
members.manage_admin_notes
```

A member must not gain access through normal profile endpoints.

---

# 92. Member Self-Service

Users should manage their own normal profile data.

Suggested permission:

```text
profile.manage_own
```

Church-specific internal fields remain separately controlled.

---

# 93. Own-Resource Authorization

Many actions require no administrative role because the resource belongs to the user.

Examples:

- edit own profile
- manage own notification settings
- respond to own duty request
- cancel own event registration
- update own availability

Ownership must still be verified server-side.

---

# 94. Parent/Guardian Relationship

Parent permissions depend on an explicit parent-child relationship.

Do not infer parent access only from:

- same surname
- same address
- church membership

The relationship must exist in the data model.

---

# 95. Multiple Guardians

A child may have multiple authorized guardians.

Each guardian relationship should independently determine access.

Removing one guardian must not affect another valid guardian.

---

# 96. Emergency Context

Do not create broad emergency permissions in V1.

If emergency access is needed later, design it separately with:

- strict scope
- reason
- time limitation
- audit trail

---

# 97. Permission Testing

Every protected feature must include authorization tests.

At minimum consider:

- allowed role
- unauthorized role
- wrong tenant
- wrong object scope
- revoked role
- revoked membership

Detailed test strategy is defined in:

`docs/TESTING.md`

---

# 98. Permission Regression Rule

Whenever permission logic changes, tests for affected roles must be updated.

A permission refactor is incomplete if only positive access tests exist.

Negative access tests are mandatory.

---

# 99. Permission Documentation Rule

When adding a new major feature, Codex must identify:

- required permissions
- permission scope
- standard roles that receive them
- sensitive implications
- object-level rules

Update this document if new platform permissions are introduced.

---

# 100. Permission Migration

Changes to permission identifiers may affect existing role assignments.

Do not rename or remove production permissions without a migration strategy.

Permission changes must preserve or intentionally transform existing role behavior.

---

# 101. Initial Standard Role Matrix

The following matrix is a product-level starting point.

Follower and Member columns describe relationships; administrative columns describe permissions within their valid tenant/object scope. The matrix does not turn relationships into assignable administrative roles.

| Capability | Follower | Member | Group Leader | Area Leader | Event Admin | Main Admin | Primary Owner |
|---|---|---|---|---|---|---|---|
| View public church content | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| View follower content | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| View normal member content | No | Yes | Yes | Yes | Yes* | Yes | Yes |
| Member directory | No | Limited | Limited | Limited | Limited* | Yes | Yes |
| Manage own profile | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Manage assigned group | No | No | Yes | No | No | Yes | Yes |
| Manage assigned area | No | No | No | Yes | No | Yes | Yes |
| Manage assigned event | No | No | No | No | Yes | Yes | Yes |
| Duty planning | No | No | No | Assigned area | No* | Yes | Yes |
| Manage members | No | No | No | No | No | Yes | Yes |
| Manage roles | No | No | No | No | No | Configurable | Yes |
| Manage church settings | No | No | No | No | No | Yes | Yes |
| Transfer ownership | No | No | No | No | No | No | Yes |
| Delete church | No | No | No | No | No | No | Yes |

`*` depends on additional membership/context permissions.

This matrix does not replace server-side permission evaluation.

---

# 102. Sensitive Child Data Matrix

| Data | Parent/Guardian | Children’s Worker | Event Admin | Main Admin | Primary Owner | Superadmin |
|---|---|---|---|---|---|---|
| Child basic profile | Own child | Assigned context | Assigned event if needed | Permission required | Permission required | No default access |
| Emergency contact | Own child | Permission + context | Permission + context | Permission + context | Permission + context | No default access |
| Allergy/medical data | Own child | Explicit permission + context | Explicit permission + context | Explicit permission + context | Explicit permission + context | No default access |
| Pickup authorization | Own child | Permission + context | Permission + context | Permission + context | Permission + context | No default access |

Administrative rank alone does not automatically justify access to highly sensitive child data.

Highly sensitive access requires explicit permission, valid operational context, current need-to-know, and appropriate auditing. Guardian access derives from the explicitly authorized guardian relationship and allowed actions; it does not require a church worker role.

---

# 103. Private Content Matrix

| Content | User | Church Admin | Primary Owner | Superadmin |
|---|---|---|---|---|
| Personal Bible notes | Own only | No | No | No |
| Direct messages | Conversation participant | No | No | No |
| Private prayer request | Authorized audience only | No automatic access | No automatic access | No |
| Admin member notes | No unless explicitly allowed | Permission required | Permission required | No default access |
| Child medical data | Authorized guardian/context permission | Explicit permission + context | Explicit permission + context | No default access |

---

# 104. Implementation Rule

Do not implement authorization as scattered role-name comparisons throughout the codebase.

Use centralized authorization mechanisms.

Prefer patterns such as:

```text
requirePermission(...)
authorizeResource(...)
authorizeTenant(...)
```

The exact implementation depends on the backend framework.

Authorization logic should be:

- reusable
- testable
- explicit
- auditable

---

# 105. Permission Decision Priority

When authorization behavior is uncertain:

1. deny access
2. protect sensitive data
3. apply tenant boundary
4. apply object-level scope
5. follow least privilege
6. avoid broad administrative access
7. document the unresolved decision

Do not silently grant broader access for convenience.

---

# 106. Relationship to Other Documents

Product behavior:

`docs/PRODUCT.md`

Architecture:

`docs/ARCHITECTURE.md`

Security:

`docs/SECURITY.md`

Testing:

`docs/TESTING.md`

Roadmap:

`docs/ROADMAP.md`

This document is the source of truth for authorization concepts and role/permission behavior.

## Task 1.12: implemented role-derived membership eligibility

This policy governs role-derived permissions, not every public, relationship-derived
or object-authorized access class:

- member: assigned canonical permissions may be effective.
- inactive: only permissions explicitly marked inactiveEligible may be effective.
  The default is false; inactivity does not retain every assigned permission.
- follower: no role-derived permissions, even if assignment rows exist.
- left: no role-derived permissions, including historical assignments.

The minimal code registry includes members.view as inactive-eligible, consistent with
retained permitted directory access, and events.create as not inactive-eligible.
No role/membership management, administration, ownership or privileged security
permission is inactive-eligible. This does not implement a directory or bypass
private-field/object policy. Roles never change relationship state. State and
assignment changes apply at the next evaluation without caching.

The internal foundation uses tenant-scoped role bundles and composite-FK assignments,
not role-name authorization. Member and Primary Owner are not ordinary roles.
No external role mutation API or privileged standard-role activation is provided;
secure TOTP and the separate assurance gate remain prerequisites for protected
capabilities. The full permission catalog and object-scoped policies remain future work.

## Task 1.13 canonical standard-role bundles

Phase 1G initially provisions only the following system-role identities. Every
row below has `isSystem=true` and `privileged=false`. The exact canonical
permission set is deliberately empty, not missing initialization data.

| Stable key | Display name | Canonical description | Permissions |
| --- | --- | --- | --- |
| `group_leader` | Group Leader | Assigned-group leadership; group-scoped capabilities remain deferred. | `[]` |
| `area_leader` | Area Leader | Assigned-area coordination; area-scoped capabilities remain deferred. | `[]` |
| `event_administrator` | Event Administrator | Assigned-event coordination; event-scoped capabilities remain deferred. | `[]` |
| `childrens_worker` | Children’s Worker | Children’s ministry identity; operational context and safeguarding capabilities remain deferred. | `[]` |

Documented Group Leader and Area Leader access requires assigned objects; Event
Administrator access requires assigned events. Children’s Worker access requires
operational need-to-know and safeguarding/audit controls. Until those contexts
exist, no church-wide substitute is granted. In particular Event Administrator
does not imply `events.create`, and none of these bundles includes `members.view`.
No new permission keys are introduced. Future changes require explicit permission
review and the corresponding object-context authorization.

Assignment uses the existing tenant membership-role model and never upgrades the
relationship state. With these empty bundles, member, inactive, follower and left
relationships all receive no role-derived permission from them. Existing separate
custom-role grants still follow Task 1.12: member normally; inactive only explicitly
eligible permissions; follower/left never. Baseline member access is not inferred
from standard-role names. No permission cache is introduced.

Canonical provisioning reconciles exact bundles, removing stray grants from these
four system roles. Generic role mutation cannot rename, delete or edit their
bundles. No privileged/ownership/platform role is made usable by this foundation.

## Task 1.15 permission-plus-assurance boundary

Permission and assurance are both required, never interchangeable. Immutable
permission metadata owns `requiresPrivilegedAssurance` and `requiresRecentStepUp`;
custom role assignments cannot edit these requirements. Unknown/incomplete metadata
fails closed. Critical requirements demand valid elevation AND proof within five
minutes. Elevation expires after 15 minutes without qualifying privileged activity
or eight hours total. No current privileged permission is activated, and the fixed
production completion gate remains false until Task 1.7b is reviewed.

The internal combined evaluator binds the server-resolved session to its actual
user and resolves that user's relationship in the scoped tenant transaction.
Membership/assignment changes are reread without caching: member permissions work
normally, inactive eligibility remains opt-in, follower/left remain denied. Losing
an assignment or permission takes effect on the next evaluation even if assurance
is still stored. Object/privacy checks remain additional requirements; assurance
never expands tenant access. Main Church Administrator, Primary Owner and Platform
Superadmin remain unavailable. Social login alone cannot satisfy future assurance.

## Task 1.16 — protected ownership foundation

Primary Owner is separate from `church_role` and `church_membership_role`.
Application-owned `church_primary_owner` binds exactly one membership at most per
church, enforced by the primary key and tenant-safe composite FK. Zero is permitted
only for foundation/provisioning before later onboarding completes the one-owner
product requirement. There is no automatic role or permission assignment.

The uncached predicate requires trusted tenant scope, the concrete authenticated
owner session, current member status and verified/enabled 2FA. Inactive, follower,
left or disabled/unverified-factor owners have no operational authority. The row is
retained; restoration to member with verified/enabled factor restores the predicate.
This does not confer ordinary feature permissions or current elevated assurance.

Initial establishment is internal, authenticated self-provisioning only; future
onboarding must authorize the church/provisioning scope. Transfer is internal and
requires current ownership plus valid session-bound elevation (15m inactivity/8h
absolute) and recent step-up (strictly less than 5m old), with an eligible same-church
member recipient who has verified/enabled 2FA. Audit insertion is mandatory and
atomic with every ownership change. A stale/concurrent loser cannot overwrite the
new owner. Self-transfer changes nothing. No ordinary role, including a custom role
named Primary Owner, can substitute for this relationship or these assurance checks.
Main Church Administrator and Platform Superadmin remain unimplemented.

## Task 1.19 — approved minimal Main Church Administrator bundle

The canonical privileged system role `main_church_administrator` contains exactly:

| Permission | Inactive eligible | Elevation required | Recent step-up required |
| --- | --- | --- | --- |
| `members.manage` | false | true | false |
| `church.settings.manage` | false | true | false |

The code uses `requiresPrivilegedAssurance` for the elevation requirement. Current
member status, enabled/verified 2FA, exact-session valid elevation and tenant-scoped
role assignment are all required. Custom roles cannot weaken permission metadata.
A stored administrator assignment may survive factor loss or membership transitions,
but effective privilege immediately fails closed. A second session without elevation
is denied. No permission cache or role-name authorization is introduced.

`members.manage` does not grant separately protected sensitive-member-data access.
`church.settings.manage` covers ordinary settings only, not security-critical settings
requiring recent step-up, church deletion or ownership. `roles.manage` remains
conditional/deferred pending delegation policy; it is not part of this bundle.
Ownership establishment/transfer/removal and the Primary Owner predicate remain
exclusively governed by Task 1.16. Platform administration is excluded.

The other four standard roles keep their empty nonprivileged bundles. Explicit
provisioning and onboarding now create exactly five roles and no assignments;
Primary Owner does not imply the administrator role or wildcard permissions.
Generic mutation cannot rename/delete a canonical system role or edit its bundle.
No public administration endpoints are added. Security-sensitive settings, deletion,
role delegation and platform administration require separate future policy review.
