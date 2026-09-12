# Church Platform – Product Specification

## 1. Purpose

The Church Platform is a modern, multi-tenant SaaS platform for Christian churches.

The product combines:

- church administration
- member engagement
- community communication
- church discovery
- event management
- service and volunteer coordination
- groups and house groups
- sermons and media
- prayer
- Bible functionality
- humanitarian and social outreach
- family and child profiles

The platform should be significantly easier to use than traditional church administration systems.

The product must feel modern, intuitive, welcoming, and useful both for church members and people who are not yet part of a church.

The platform is not only an administration tool.

It should bring the entire life of a church together in one digital place.

---

# 2. Product Principles

The platform must be:

- intuitive
- modern
- visually attractive
- easy to understand
- mobile-first
- privacy-focused
- secure
- accessible
- scalable
- cost-efficient

Users should normally be able to use the application without training.

Avoid complex administration workflows whenever a simpler solution exists.

The platform should not feel like traditional ERP software.

---

# 3. Target Users

The platform supports several user types.

## 3.1 Visitors

Visitors may use the platform without an account.

They may:

- search for churches
- view public church pages
- view public events
- view public sermons
- view public social and humanitarian offers
- view service times
- view publicly available church information

Visitors cannot access protected church content.

---

## 3.2 Registered Interested Users / Followers

A registered user may follow a church without becoming a member.

Followers may:

- follow church updates
- receive public or follower-targeted news
- receive sermon updates
- receive event information
- access content that requires registration
- later request membership

Following a church is different from being a member.

---

## 3.3 Church Members

Church members have a confirmed relationship with a church.

Members may access internal church functions according to their permissions.

Examples include:

- internal church news
- member directory
- groups
- events
- prayer requests
- duties
- volunteer needs
- church calendar
- internal sermons or resources

---

## 3.4 Volunteers and Employees

A member may have multiple service roles.

Examples:

- musician
- singer
- technician
- preacher
- pastor
- youth leader
- children’s worker
- kitchen worker
- reception volunteer
- pastoral care volunteer
- event worker
- media worker
- sound technician
- projection operator
- camera operator

Roles are not mutually exclusive.

A person may serve in several areas at the same time.

---

## 3.5 Leaders and Administrators

Examples:

- group leader
- area leader
- event administrator
- church administrator
- main church administrator
- Primary Owner
- platform superadmin

Detailed authorization rules are defined in:

`docs/PERMISSIONS.md`

---

# 4. Multi-Church User Model

A user has one central platform account.

A user may belong to multiple churches.

Example:

- member in Church A
- musician in Church B
- follower of Church C

Roles and permissions are church-specific.

Membership in one church must not automatically provide access to another church.

---

# 5. Supported Christian Churches

The platform must work for a broad range of Christian churches.

Examples:

- Protestant
- Catholic
- Baptist
- Pentecostal
- Mennonite
- Brethren
- Orthodox
- independent churches
- non-denominational churches

The software must not hardcode one specific denomination or theological organizational model.

During church creation, the church selects a denomination or confession.

The selection may influence recommended starter templates.

Existing church structures must never be overwritten when the denomination is changed.

---

# 6. Platform Account and Registration

Supported registration methods:

- email and password
- Google
- Apple

Email verification is mandatory before full account use.

Initial email/password registration requires only:

- username
- email
- password

Google/Apple users do not need an additional local password. Linking authentication methods requires an explicit secure flow with recent authentication; matching email addresses alone must not merge accounts. Privileged access requires the same mandatory 2FA assurance regardless of sign-in method, as defined in [ADR 0003](adr/0003-authentication-and-sessions.md).

Additional profile information may be added later.

Examples:

- first name
- last name
- date of birth
- profile picture
- address
- phone number

---

# 7. Personal Profile

Every user has a personal platform profile.

The profile may contain:

- username
- profile picture
- first name
- last name
- birthday
- email
- phone number
- address
- short biography
- churches
- groups
- service areas

Username and profile picture are the primary platform identity.

Other profile information is privacy-controlled.

The user controls which optional information is visible.

---

# 8. Friends and Contacts

Users may send platform-wide friend/contact requests.

This works across churches.

A request can be:

- accepted
- declined

Users may also:

- block another user
- report another user

Direct messaging is available only after the contact request has been accepted.

---

# 9. Personal Home Screen

The mobile application uses the following main navigation:

- Home
- Feed
- Calendar
- Church
- Profile

The Home screen is personalized automatically.

Users do not manually configure the Home layout in V1.

---

## 9.1 “For You” Section

The Home screen contains a prominent “For You” section.

Examples:

- duty request waiting for response
- service tomorrow
- event registration deadline
- child event registration
- important message requiring confirmation
- replacement requested for a duty

The system should prioritize actionable content.

---

## 9.2 Additional Home Sections

Possible sections include:

- upcoming dates
- my duties
- current news
- prayer
- Bible
- my tasks

Sections not relevant to the current user should disappear.

---

# 10. Church Area

The Church section contains the organizational church world.

Possible modules:

- events
- duties
- groups
- areas
- member directory
- sermons
- prayer
- needs/help
- tasks
- organizational structure

If a user belongs to multiple churches, the selected church can be switched from the top of the screen.

The application remembers the last selected church.

The switcher visually distinguishes between:

- My Churches
- Churches I Follow

---

# 11. Church Creation

Authorized users may create a church.

The onboarding process should be a short setup assistant.

Required or recommended data:

- church name
- address
- denomination/confession
- logo
- service times
- public visibility

After creation, the church receives a setup checklist.

Example items:

- upload logo
- enter service times
- import members
- create service areas
- create first event
- review public page
- complete verification

---

# 12. Church Verification

New churches may initially operate as unverified churches.

Target verification period:

30 days.

Possible verification methods include:

- official church email confirmation
- publicly verifiable church website or imprint
- confirmed responsible person

Platform superadmins may:

- request additional evidence
- approve verification
- reject verification
- revoke verification later

Verification status must be visible where relevant.

---

# 13. Public Church Page

Each church can activate a public web page inside the platform.

The public page is accessible without an app or account.

A church may deactivate the page.

When deactivated, the church should no longer appear in public church discovery.

---

## 13.1 Public Page Content

Possible sections:

- church introduction
- service times
- public events
- sermons
- social/help offers
- office hours
- contact
- contact persons

Only content explicitly marked public may appear.

---

## 13.2 Public Page Design

The church may configure:

- logo
- title/hero image
- accent color

The page is built from platform-designed content blocks.

Examples:

- About Us
- Service Times
- Contact Persons
- Events
- Sermons
- Help Offers
- Office Hours
- Contact

Blocks can be:

- enabled
- disabled
- reordered

The platform controls the design system.

Churches do not build their own custom website themes in V1.

---

## 13.3 Public URL

Each public church page receives a unique slug.

Example:

`platform-domain.com/church-slug`

The slug must be:

- unique
- validated
- protected against reserved system words

Public pages should support search engine indexing where enabled.

Only public content may be indexed.

---

# 14. Church Discovery

Users can search for churches.

Search criteria may include:

- church name
- city
- postal code
- distance
- language
- denomination
- accessibility
- children’s church
- childcare
- youth programs
- translation
- social/help programs

---

## 14.1 Search Result Design

Default search results should use modern cards.

A card may show:

- logo
- church name
- distance
- next service
- important attributes

An optional map view may also exist.

---

# 15. Followers

Every publicly active church supports followers.

A registered user can:

- follow a church
- request membership

These actions are distinct.

When a user follows a church, the church receives a notification.

Church administrators may see followers.

Follower management remains intentionally simple.

Visible follower information may include:

- profile picture
- username
- follow date
- voluntarily shared profile data

Church administrators may:

- remove a follower
- block a follower

If a follower later requests membership, the same person relationship should transition into membership processing.

Do not create duplicate person records.

---

# 16. Membership Requests

A user may request membership in a church.

Before submitting a membership request, the following information is required:

- first name
- last name
- date of birth
- phone number
- address

A profile picture remains optional.

Churches may define additional custom questions.

The user must intentionally choose between:

- Follow Church
- Request Membership

---

## 16.1 Membership Request Handling

The membership process should remain simple.

There is no complex workflow engine in V1.

Administrators may:

- review request information
- maintain internal notes
- accept request
- reject request

When accepted, a compact setup step allows assignment of:

- membership status
- groups
- service areas
- roles

---

# 17. Membership Status

Platform-wide base statuses:

- Follower / Interested
- Member
- Inactive
- Left Church

Churches may define additional internal statuses.

These must not replace the platform base status model.

---

## 17.1 Inactive

Inactive means:

The person is still formally a church member but should normally not be considered for active volunteer planning.

Examples:

- long-term travel
- mission trip
- studies
- extended absence

---

## 17.2 Leaving a Church

When a member leaves:

- status becomes “Left Church”
- user is removed from active groups
- user is removed from active service areas
- user is removed from active service planning

Historical references remain.

Examples:

- past events
- historical service assignments
- administrative history

Leaving the church does not automatically convert the user into a follower.

The user may manually follow the church again later.

---

# 18. Church Member Data

Churches may maintain internal member master data.

Examples:

- entry date
- baptism date
- member number
- remarks

Churches may define custom fields.

Examples:

- first aid qualification
- instruments
- languages
- driver’s license

Members should be able to see which normal internal data the church stores about them.

Protected administrative notes are excluded from this transparency view.

---

# 19. Member Directory

Each church has a searchable member directory.

Search may include:

- name
- username
- group
- area

Normal members see by default:

- username
- profile picture

Additional profile information is shown only according to the person’s privacy settings.

Authorized administrators may have a separate advanced management view.

---

# 20. Organizational Structure

A church may define a simple internal organizational structure.

Examples:

- church leadership
- elders
- deacons
- pastors
- area leaders
- ministry leaders

This structure may be visible to members.

Organizational functions may also carry permissions.

Detailed authorization behavior belongs in:

`docs/PERMISSIONS.md`

---

# 21. Areas and Ministries

Churches can create flexible organizational areas.

Examples:

- children
- youth
- technology
- music
- worship
- pastoral care
- house groups
- administration
- mission
- evangelism
- seniors
- women
- men
- refugee support
- social work
- café
- prayer
- media
- church planting

Churches may create their own custom areas.

Each area may contain:

- leaders
- members
- skills
- service responsibilities

---

# 22. Social Feed

The platform includes a modern content feed.

Posts may contain:

- text
- images
- video links or supported media

Users may:

- react
- comment
- save
- share within the platform

Churches choose the target audience.

Examples:

- public
- followers
- members
- volunteers
- youth
- selected group
- selected area

---

## 22.1 Important Posts

Posts may be marked important.

Important posts may optionally trigger push notifications.

Posts may also be:

- scheduled for future publication
- pinned
- given an expiry date

Expired posts leave the active feed but are not necessarily deleted.

---

# 23. Important Messages

Authorized users may send important messages.

An important message may require read confirmation.

The sender may see:

- number of recipients
- number read
- number confirmed

Example:

- 184 recipients
- 162 read
- 148 confirmed

The sender may optionally activate an automatic reminder after 24 hours for users who have not confirmed.

Important messages may optionally also trigger email delivery.

Emails use a general platform sender address.

---

# 24. Notifications

Users have platform-wide default notification settings.

These defaults apply when joining or following a new church.

The user may override settings per church.

Notification categories may include:

- friend requests
- chat
- church news
- group news
- events
- registration changes
- duty requests
- duty changes
- helper needed
- duty reminders
- prayer updates
- help requests
- new sermons
- devotionals

Each category supports:

- Push
- In-App Only
- Off

Security-critical system notifications cannot be disabled.

---

# 25. Calendar

The user has a central personal calendar.

It aggregates relevant dates from all churches.

Examples:

- church events
- group meetings
- accepted duties
- registrations
- child events
- personal church-related appointments

Only dates the user is authorized to see may appear.

---

## 25.1 Calendar Layers

Users may toggle layers.

Examples:

- Church A
- Church B
- Youth
- House Group
- Child 1
- Child 2
- My Duties

---

## 25.2 Calendar Integrations

The platform should support synchronization or export to:

- Apple Calendar
- Google Calendar
- Outlook

Individual events should also be exportable.

Recurring events are supported.

Examples:

- every Sunday at 09:00
- every second Thursday
- first Saturday of the month

Appointment booking is not part of V1.

---

# 26. Events

Churches can create different event types.

Examples:

- worship service
- children’s service
- public event
- retreat
- camp
- youth event
- seminar
- church festival
- helper event
- house group evening

---

## 26.1 Event Registration Fields

Registration forms support configurable fields.

Possible field types:

- text
- number
- select
- multi-select
- checkbox
- date
- time
- free text

Fields may be required or optional.

Known account or family data should be prefilled where appropriate.

---

# 27. Event Templates

Three levels of templates exist.

## 27.1 Platform Templates

Created by the platform operator.

Visible to all churches.

Examples:

- worship service
- youth night
- retreat
- children’s event
- seminar
- church festival
- helper event
- house group evening

---

## 27.2 Church Templates

Churches may create or modify their own templates.

---

## 27.3 Concrete Event

An event may be created from a template and customized.

Changing the event must not automatically change the original template.

---

# 28. Event Audiences

A church decides who may register for each event.

Possible audiences:

- members only
- members and followers
- all registered users

Events may also have age restrictions.

Examples:

- 8–12
- 16+
- 18+

Eligibility should be checked using the stored date of birth.

---

# 29. Event Capacity and Waitlist

Events may define a maximum participant count.

A waitlist may optionally be activated.

When a spot becomes available, the next eligible person may automatically move from the waitlist into the event.

---

# 30. Event Pricing

Events may have participation fees.

Multiple price categories are supported.

Example:

- adults: €120
- youth: €80
- children: €40

Payment itself occurs outside the platform in V1.

Administrators may track payment status.

Possible states:

- open
- paid
- waived
- cancelled

Coupon codes are not part of V1.

---

# 31. Event Guest Registration

If enabled, a registered user may register additional guests.

The church defines which guest fields are required.

Parents may register multiple children within one registration flow.

---

# 32. Event Administrators

An event may have one or more event administrators.

Event administrators only receive permissions for that event.

Possible actions:

- view participants
- edit registrations
- update payment status
- manage waitlist
- cancel registrations
- advance waitlist

They do not automatically receive general church administration permissions.

---

# 33. Event Check-In

Events may activate check-in mode.

Possible check-in methods:

- manual check-in by event administrator
- QR-code check-in

Registered participants may receive a personal QR code.

Possible participation states:

- registered
- checked in
- cancelled
- no-show

Churches may view historical attendance statistics.

---

# 34. Child Event Check-In

Child events additionally support:

- checked in
- picked up

Authorized caregivers may see pickup authorization.

An optional strict checkout mode may require explicit confirmation when the child is picked up.

---

# 35. Family and Child Profiles

Parents may create managed child profiles.

A child profile can contain:

- name
- date of birth
- allergies
- medically relevant notes
- emergency contact
- pickup authorizations

This data is highly sensitive.

Access must be strictly controlled.

---

## 35.1 Shared Parent Management

Both parents may be linked to the same child profile.

Depending on permissions, both may:

- maintain child data
- register the child for events
- view relevant dates
- view relevant child information

---

## 35.2 Child Profile Experience

Child profiles behave like subprofiles under the parent account.

The parent may switch between:

- personal profile
- Child 1
- Child 2

The child context may show:

- upcoming events
- registrations
- groups
- dates
- notices
- child-related news

The UI may be more child-friendly when viewing a child profile.

---

## 35.3 Conversion to Independent Account

Later, a child profile may become an independent platform account.

The existing child entity should be converted.

Do not create a completely unrelated new person.

Where appropriate, preserve:

- group history
- event history
- favorites
- relationships
- relevant tasks

---

# 36. Groups

The platform provides a general group module.

Examples:

- house groups
- youth groups
- choir
- prayer groups
- teams
- Bible study groups

A group may contain:

- chat
- appointments
- participants
- files
- prayer requests
- announcements
- learning content

Tasks may appear contextually, but V1 must not introduce complex task-to-group project structures.

---

# 37. Group Visibility and Joining

Groups may be:

- visible
- hidden

Possible joining modes:

- open join
- request to join
- invitation only

Groups may define a maximum participant count.

An optional waitlist may be activated.

---

# 38. Group Leadership

A group may have multiple equal leaders.

Group leaders may:

- manage participants
- handle join requests
- create appointments
- publish group posts
- manage files
- manage supported group functions

They do not automatically receive church-wide administrative rights.

Nested granular permission delegation inside groups is not required in V1.

---

# 39. Bible Study and House Group Content

House group leaders may create Bible studies.

Possible elements:

- Bible passages
- teaching text
- questions
- open reflection questions
- quizzes
- personal notes
- tasks/work materials

Pastors or authorized church administrators may create central studies and distribute them to selected or all house groups.

Groups may optionally add their own notes or questions.

---

# 40. Bible Study Templates

Three inheritance levels exist:

Platform Template

→ Church Template

→ Concrete Group Lesson

Changes to a concrete lesson must not automatically overwrite the original template.

---

# 41. Prayer Module

Prayer requests are never fully public.

Possible audiences:

- private
- friends
- selected group
- selected church
- anonymous inside selected protected audience

Every prayer request requires an expiry date.

Available presets:

- 7 days
- 30 days
- 100 days
- 180 days
- 365 days

A custom date may be selected up to one year in the future.

---

## 41.1 Prayer Updates

The creator may:

- post updates
- extend the request
- end the request
- mark the prayer as answered

The original prayer history should remain meaningful when marked as answered.

Users may click:

“I am praying for this.”

The creator sees the number of people praying.

---

# 42. Bible Module

The platform contains a personal Bible area.

The Bible module is independent of a specific church.

Only Bible translations legally usable by the platform without required paid licensing should be included.

Users may:

- highlight verses
- save favorites
- create private verse notes

Bible notes and highlights are private by default.

Bible reading plans are not required in V1.

AI Bible functionality is not part of V1.

---

# 43. Sermons and Media Library

Churches may publish sermons.

Supported media:

- YouTube video links
- uploaded audio files

Direct video file uploads are not supported in V1.

---

## 43.1 Sermon Metadata

Possible fields:

- title
- preacher
- date
- Bible passage
- sermon series
- description
- topic

Sermons may belong to sermon series.

---

## 43.2 Sermon Search

Users may search or filter sermons by:

- preacher
- Bible passage
- date
- topic
- series

Users may favorite sermons.

---

## 43.3 Sermon Attachments

Sermons may contain attachments.

Examples:

- sermon notes
- handouts
- PDF
- presentation slides

Sermons do not need to be directly linked to a service event in V1.

---

## 43.4 Media Library Navigation

The media area should include views such as:

- New
- Series
- Preachers
- Topics
- Search

---

# 44. Service and Duty Planning

Church events may contain unlimited duties.

Reusable service templates may define standard duties.

Example:

Sunday Service Template:

- sermon
- moderation
- worship
- sound
- projection
- children
- kitchen
- camera

---

# 45. Service Areas and Skills

Duties originate from service areas.

Example:

Technology:

- sound
- projection
- camera

Music:

- singer
- piano
- guitar
- drums

Members may declare skills they would like to use.

Area leaders confirm the relevant skills.

---

# 46. Duty Assignment

Area leaders may:

- request specific eligible people
- publish open positions
- assign people
- review responses

Eligible members may:

- accept a request
- decline a request
- sign up for an open duty

After accepting, a member may request a replacement.

Possible duty states:

- open
- requested
- accepted
- declined
- replacement requested

---

# 47. Duty Availability

Users may define periods when they are unavailable.

Fields:

- from date
- to date
- optional reason

Authorized planners may see the reason.

Recurring absence rules are not required in V1.

---

# 48. Desired Serving Frequency

A member may define an approximate desired service frequency.

Examples:

- maximum once per month
- twice per month
- no limit

This is guidance rather than a hard scheduling rule.

---

# 49. Fairness and Conflict Detection

When assigning duties, planners should see helpful information.

Examples:

- served 2 times in the last 30 days
- unavailable in October
- already has another duty
- conflict with another church

Conflicts should normally generate warnings rather than hard blocks.

Conflicts must also be detected across multiple churches when appropriate.

---

# 50. Automatic Rule-Based Duty Planning

The platform supports rule-based automatic duty planning.

This is explicitly not AI.

An area leader selects a planning period.

Examples:

- next month
- next six weeks
- custom date range

The planner considers:

- confirmed skills
- availability
- absences
- conflicts
- desired serving frequency
- recent service load
- fair distribution

The generated result is always a draft.

It must never automatically publish assignments.

If no eligible person exists, the system should explain why.

Examples:

- no qualified person
- all eligible people unavailable
- scheduling conflicts

After reviewing the draft, the leader may send all requests.

---

# 51. Duty Planning Views

Area leaders should have:

- calendar/month view
- list view

Useful filters:

- open
- requested
- filled
- replacement requested

Leaders may select several duties and send bundled requests.

Responses remain individually trackable.

---

# 52. Duty Reminders

Users receive reminders for accepted duties.

Reminder timing should be configurable by the user.

Example:

previous day at 20:00

Personal defaults may be overridden where appropriate.

---

# 53. Duty and Volunteer Analytics

Church administrators may see planning statistics.

Examples:

- percentage of duties filled
- open duties by area
- recurring shortages
- members currently without a service role
- members who have not served in a configurable period

These metrics must be presented respectfully and without judgment.

The purpose is planning and leadership support.

---

# 54. Needs and Help

The platform contains a general Needs / Help module.

Examples:

- 10 cakes needed
- 5 helpers for setup
- winter clothing needed
- drivers needed
- guest beds needed
- food donations needed
- skilled tradesperson needed

Needs may request:

- goods
- quantities
- volunteers

---

## 54.1 Progress Tracking

Example:

10 cakes needed

7 promised

The app shows an attractive progress indicator.

For helpers:

5 helpers needed

3 found

---

## 54.2 Visibility

Needs may be:

- internal
- visible to registered followers/interested users

Needs should not be completely anonymous/public when participation is required.

A user must register before committing help.

---

# 55. Social and Humanitarian Outreach

The platform should help churches organize social outreach.

Examples:

- support for people in poverty
- homeless support
- addiction support
- family assistance
- food distribution
- clothing distribution
- humanitarian projects

Public church pages may show suitable help offers.

Possible content:

- opening times
- locations
- contact
- signup requirements
- current volunteer needs
- required goods
- donation information

The platform should make “I need help” and “I want to help” easy to discover.

---

# 56. Donations

Donation functionality is intentionally simple in V1.

A church may configure:

- bank details
- external donation page
- optional PayPal link

There is no in-app payment processing.

There is no personal donation history in V1.

Donation campaigns and funding goals are not required in V1.

---

# 57. Tasks

The application contains a lightweight church task module.

This is not a project management system.

Tasks exist only in church context.

Fields:

- title
- description
- one or more responsible people
- due date
- status
- comments
- attachments

Possible states:

- Open
- In Progress
- Done

There is no priority field.

---

## 57.1 Multiple Assignees

A task may be assigned to several people.

The task is considered complete when one assigned person completes it.

---

## 57.2 My Tasks

Users have a “My Tasks” view.

It aggregates assigned church tasks across all churches.

---

## 57.3 Explicit Task Exclusions

V1 does not support:

- private personal tasks
- recurring tasks
- task creation directly from messages
- complex task-to-group relationships
- task-to-event project structures
- project management structures

---

# 58. Chat and Communication

The platform contains direct and group communication.

Direct chat is available after an accepted friend/contact relationship.

Supported communication features may include:

- text
- images
- files
- voice messages
- replies
- reactions
- read receipts
- mute
- report
- block

Audio and video calling are not required in V1.

---

# 59. Announcement Channels

Churches may have announcement channels.

Examples:

- Church News
- House Group News
- Volunteer News

Only authorized users may publish.

Other users may read and react according to permissions.

---

# 60. Global Search

The application contains global search.

Search must always respect permissions.

Possible public results:

- churches
- public sermons
- public events
- public posts

Logged-in users may additionally see authorized internal results.

Examples:

- church posts
- groups
- internal events

Hidden groups, administrative data, and sensitive personal data must never leak through search.

---

# 61. File Handling

Users may upload files where supported.

Examples:

- event attachments
- sermon files
- group files
- task attachments

Each church receives a limited storage quota.

Sermon audio has a separate logical quota from general church storage. Exact plan-dependent limits are deferred.

---

# 62. Church Storage Management

Authorized administrators may see:

- total storage used
- remaining storage
- storage by category
- large files
- old files

Possible categories:

- sermons
- group files
- images
- other

Central storage management exists primarily for storage control and cleanup.

It is not intended as a full enterprise document management system.

Deleting a file that is referenced somewhere should generate a warning.

---

# 63. Personal Files

Users may have a personal Files area.

It primarily displays files the user uploaded or has access to.

Users may download files they are authorized to access.

External public file-sharing links are not required in V1.

Internal platform links are sufficient.

---

# 64. Church Administration Dashboard

Authorized administrators receive a modern church administration area.

It must not look like a traditional ERP interface.

Use a clean dashboard and cards.

Possible administration modules:

- Members
- Roles & Permissions
- Groups
- Areas
- Events
- Duties
- Storage
- Templates
- Settings

Only modules the user may access should be shown.

Do not display inaccessible modules merely as disabled cards.

---

# 65. Administration Analytics

Possible dashboard information:

- member growth
- new members
- members who left
- number of followers
- upcoming events
- registrations
- open duties
- open needs
- unread confirmations
- service coverage

Detailed communication reach analytics are not required in V1.

---

# 66. Platform Superadmin

The platform contains a separate superadmin web backend.

Superadmins may manage platform-level functions.

Examples:

- churches
- verification
- tenants
- SaaS plans
- support cases
- global templates
- platform configuration
- audit logs

Private user content must remain protected according to security and privacy rules.

---

# 67. SaaS Plans

The platform initially supports three main church plans:

- Free
- Basic
- Pro

The initial pricing model is a fixed monthly price per church.

Price does not initially depend on the number of users.

The architecture should allow later user/member-based pricing without a complete redesign.

---

## 67.1 Plan Differences

Possible differences:

- storage quota
- media quota
- premium functionality
- advanced features

The platform operator may create special plans.

Examples:

- free partner church
- discounted church
- test church
- mission project
- custom storage allowance
- custom feature override

---

# 68. Internationalization

Initial platform languages:

- German
- English
- Portuguese

Language is a personal platform-wide user setting.

Two users may use the same church in different interface languages.

System UI must support localization.

Church-created content does not require automatic translation in V1.

---

# 69. Public Website Widgets

Churches should later be able to embed selected public content on external websites.

Initial widget concepts:

- next service
- upcoming events
- sermons

Widgets should be easy to embed on websites such as WordPress.

A general public developer API is not required in V1.

---

# 70. Accessibility

Accessibility is a product requirement.

The application should support:

- screen readers
- semantic labels
- scalable text
- sufficient contrast
- large touch targets
- keyboard navigation on web

Both mobile and web interfaces must consider accessibility.

---

# 71. Dark Mode

The application supports:

- light mode
- dark mode
- system theme

---

# 72. Design Language

The visual design should be:

- modern
- calm
- premium
- welcoming
- clean
- spacious

Use:

- strong typography
- clear icons
- cards
- helpful visual hierarchy
- subtle animations

Avoid:

- clutter
- overly colorful interfaces
- childish visuals
- old-fashioned enterprise software appearance

---

# 73. Import

Churches should be able to import data.

Initial supported formats should include:

- CSV
- Excel

Possible import categories:

- members
- groups
- service areas
- duties
- other master data

A future ChurchTools import may be added if available export formats permit it.

---

# 74. Export and Data Portability

Churches may export their own data.

Examples:

- members
- groups
- events
- duties
- configuration

Before deleting an entire church, a full export should be possible.

Where technically and legally appropriate, this may include related files.

---

# 75. User Account Deletion

Users may request complete account deletion.

There is a three-month transition period before final deletion or anonymization.

After the retention period:

- personal data should be deleted where possible
- historical references may be anonymized where required

Examples of historical references:

- past duties
- events
- audit records

Legal retention requirements must be respected.

---

# 76. Church Deletion

Deleting an entire church has a 30-day protection period.

Critical deletion actions require additional authentication according to the security specification.

The church should be able to request an export before final deletion.

---

# 77. One Church Equals One Tenant

V1 explicitly does not contain:

- campuses
- branches
- church locations as separate sub-organizations
- hierarchical local congregations under one tenant

One church equals one tenant.

A church has its normal address and service times.

An individual event may have its own location/address.

Future church networks, associations, or federations may be considered later but are outside current scope.

---

# 78. Explicitly Out of Scope for V1

Unless explicitly requested later, do not implement:

- AI sermon summarization
- AI transcription
- AI Bible interpretation
- AI scheduling
- direct uploaded video hosting
- in-app payments
- donation campaigns
- coupon codes
- personal donation history
- passkeys
- audio/video calls
- recurring absence patterns
- personal task management
- project management
- appointment booking
- automatic translation of church-created content
- public general-purpose developer API
- campus/branch hierarchy

---

# 79. Product Decision Rule

When product behavior is unclear:

1. prefer the simplest understandable workflow
2. minimize the number of required steps
3. protect privacy by default
4. preserve multi-tenant isolation
5. avoid introducing unnecessary administration
6. prefer reusable templates
7. support mobile-first usage
8. hide irrelevant functionality
9. do not invent major new features
10. document unresolved product decisions instead of silently making major scope changes

---

# 80. Source of Truth

This file defines the intended product functionality.

Technical architecture is defined in:

`docs/ARCHITECTURE.md`

Security and privacy rules are defined in:

`docs/SECURITY.md`

Roles and authorization rules are defined in:

`docs/PERMISSIONS.md`

Testing requirements are defined in:

`docs/TESTING.md`

Implementation order is defined in:

`docs/ROADMAP.md`

If implementation conflicts with this product specification, the conflict must be identified before silently changing product behavior.