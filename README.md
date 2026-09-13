# ChurchApp

Modern multi-tenant SaaS platform for Christian churches.

## Project Status

The project is currently under active development.

The platform will provide:

- iOS and Android applications using Flutter
- a full web application
- church administration
- platform administration
- church discovery
- memberships and followers
- events
- groups
- duty planning
- communication
- prayer
- Bible features
- sermons
- family and child profiles
- social and humanitarian support features

## Documentation

The authoritative project documentation is located in `/docs`.

### Product

See:

`docs/PRODUCT.md`

This document defines what the application should do.

### Architecture

See:

`docs/ARCHITECTURE.md`

This document defines the technical architecture.

### Security

See:

`docs/SECURITY.md`

Security and privacy requirements are mandatory.

### Permissions

See:

`docs/PERMISSIONS.md`

This document defines roles and authorization rules.

### Testing

See:

`docs/TESTING.md`

All development must follow the testing requirements.

### Roadmap

See:

`docs/ROADMAP.md`

Codex must follow the implementation roadmap and must not attempt to implement the entire platform at once.

## Codex

Codex instructions are located in:

`AGENTS.md`

Codex must read `AGENTS.md` before making changes.

For significant features, Codex must also read the relevant documentation under `/docs`.

## Core Principles

The platform must remain:

- secure
- privacy-focused
- multi-tenant
- intuitive
- modern
- accessible
- scalable
- cost-efficient

Security and tenant isolation take priority over development speed.

## Workspace Development

Use Node.js `>=24.19.0 <25` and pnpm `11.19.0` (pinned in `package.json`).
The foundation was validated with Node.js `24.19.0`. Have these tools available
on PATH; installation does not install or upgrade global tools.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm format:check
```

Use `pnpm format` to format the foundation files, API/web workspaces, and this README. Existing
architecture documents are not reformatted by these scripts. Expand formatting
coverage as source packages are introduced. Prettier uses the shared
`.editorconfig` defaults; its generated lockfile is not manually formatted.

pnpm discovers actual package manifests under `apps/*`, `services/*`, and
`packages/*`. Flutter remains a separate Dart project under `apps/mobile` and
needs no Node package manifest. The API, main web, platform-admin, and shared
contracts workspaces are implemented; Flutter remains independent of pnpm.
No additional monorepo orchestrator is required.

`tsconfig.base.json` shares strictness and casing checks only. Application
configs will choose their own module resolution, target, JSX, and output settings.
The API owns its TypeScript/build/test tooling. API linting remains deferred; web linting is scoped to its workspace.

The only root development dependency is Prettier. Commit `pnpm-lock.yaml` with
intentional dependency changes, and use frozen installs for reproducibility.
pnpm's store/cache/state stay in Git-ignored local directories. Environment
files must remain local; never commit real credentials.

## Local PostgreSQL Development

Requires Docker Desktop running Linux containers (WSL2 on Windows), with Docker
and Compose available in the host terminal. Run commands from the repository root:

```sh
pnpm db:up
pnpm db:status
pnpm db:logs
pnpm db:down
```

These scripts use `infrastructure/docker/compose.dev.yml`. Logs follow the service;
Ctrl+C ends log viewing. `db:down` stops/removes the container but retains its volume.
No automatic restart is configured; start it explicitly when needed.

The image is `postgres:18.6`. Defaults are host `localhost`, port `5432`, database
`church_platform_dev`, user `church_dev`, and public development-only password
`local_dev_only`. The published port binds only to `127.0.0.1`. `.env.example`
contains matching local examples, including the host-based `DATABASE_URL`; never
reuse these credentials for staging/production or use production data locally.

No `.env` is needed for defaults. Override values through the host environment or
an optional Git-ignored root `.env`. Check host port availability before starting;
if occupied, set `POSTGRES_PORT=5433` and update your local `DATABASE_URL` port.
Changing `DATABASE_URL` alone does not configure the container. Future containers
on the same network will use `postgres:5432` instead of `localhost`.

Compose project `church-platform-dev` manages named volume
`church-platform-dev_postgres_data`, mounted at `/var/lib/postgresql` for
PostgreSQL 18. Data stays in Docker-managed storage outside this repository.
Initialization values apply only to an empty volume; changing environment values
does not rename an existing database/user or reset its password.

Only standard image initialization is configured. The bootstrap user is a local
superuser, not the future runtime API identity. Restricted roles, RLS, application
schemas and migrations will be introduced later under ADRs 0002/0006.

Runtime validation must run in Windows PowerShell (or another host terminal with
Docker access): Compose configuration, image pull/startup, healthy status, server
version 18.6, database/user SQL queries, published-port reachability, and persistence
across restart with the same volume. These checks have not run inside Codex.

## API Shell

The private `@church-platform/api` workspace lives in `services/api`, using NestJS
12 with the standard Express adapter. From the repository root:

```sh
pnpm api:dev
pnpm api:typecheck
pnpm api:test
pnpm api:build
pnpm api:start
```

`api:dev` compiles and watches for changes. `api:start` runs the built output;
build first. The API binds to `0.0.0.0` on `PORT` (default `3000`, valid range
1–65535). Set `PORT` in the launching environment; `.env` is not loaded by this
shell. Visit `http://localhost:3000/api/v1/health` for HTTP 200 and `{"status":"ok"}`.
This endpoint checks service responsiveness only, without PostgreSQL or Docker.
Shutdown hooks handle termination; global DTO validation transforms inputs and
rejects non-whitelisted properties without exposing validation values/details.

Tests use Vitest, Nest testing utilities, and Supertest. SWC preserves decorator
metadata in tests; pnpm permits the SWC and Drizzle Kit esbuild install hooks only. The API
uses ESM/NodeNext and TypeScript 6 to match Nest CLI tooling. Strict source and
test checking remains enabled; API-local `skipLibCheck` excludes third-party
library declarations with optional bundler types. Authentication, tenant authorization,
and business modules are intentionally absent.

## Shared TypeScript Contracts

`packages/contracts` contains the private `@church-platform/contracts` package
for framework-independent transport contracts shared by the NestJS API and
future TypeScript clients. From the repository root:

```sh
pnpm contracts:typecheck
pnpm contracts:test
pnpm contracts:build
```

Flutter does not import this TypeScript package; its language-neutral boundary
is the versioned HTTP/OpenAPI API.

## Database Foundation

The API requires `DATABASE_URL` in its launching environment and fails at startup
if it is missing or malformed. Neither the API nor Drizzle Kit automatically loads
`.env`. For the public local defaults, run from the repository root in PowerShell:

```powershell
pnpm db:up
$env:DATABASE_URL = (Get-Content .env.example | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
pnpm api:dev
```

If local credentials/ports differ, set the matching URL in your shell instead.
Never use production credentials/data for local development. The current local
bootstrap superuser is suitable only for this empty foundation; separate migration
and restricted runtime roles are required before implementing tenant tables/RLS.
Basic `/api/v1/health` stays a liveness check and never queries the database.

The non-global Nest `DatabaseModule` owns one `pg.Pool` (maximum 10 clients,
5-second connection timeout, 30-second idle timeout) and closes it on shutdown.
Its `DatabaseService` provides typed Drizzle access for infrastructure and future
module-owned repositories, not direct controller access. `transaction()` borrows
one client and uses Drizzle for commit/rollback, with guaranteed release even on
BEGIN failure. All operations in an atomic use case must use the callback's
transaction handle; never fall back to `db` or another connection inside it.
`withClient()` is a bounded infrastructure escape hatch, not a tenant bypass.
Trusted tenant context and transaction-local RLS remain required future work
before the first tenant-owned tables, per ADR 0006.

The canonical schema is `services/api/src/database/schema/index.ts`, intentionally
empty. Drizzle Kit reads `services/api/drizzle.config.ts`; reviewed SQL and its
snapshots will live under `services/api/migrations`. Drizzle Kit initializes an empty
migration journal; no SQL migration is needed yet.
After a future schema change, with `DATABASE_URL` set:

```sh
pnpm db:generate
# Review the generated SQL and snapshots before applying; commit both together.
pnpm db:check
pnpm db:migrate
```

`db:check` checks migration snapshot consistency, not live database drift or proof
that every schema edit has a migration. Production uses reviewed migrations in one
controlled deployment step, never automatic synchronization or `drizzle-kit push`.
Use separate migration credentials there; plan risky changes and rollback per ADR 0002.

Fast tests require no PostgreSQL. The separate integration suite requires the
local database and `DATABASE_URL` set as above; it verifies real connections,
server version, transaction commit/rollback and release without creating tables:

```sh
pnpm api:test
pnpm api:test:db
pnpm api:typecheck
pnpm api:build
```

## Main Web Shell

`apps/web` is the private `@church-platform/web` Next.js App Router workspace.
It runs independently of the API and PostgreSQL. From the repository root:

```sh
pnpm web:dev
pnpm web:typecheck
pnpm web:test
pnpm web:lint
pnpm web:build
pnpm web:start
```

Open `http://localhost:3000`. Build before using `web:start`. Typecheck generates
Next.js route types before checking source and tests. Vitest, React Testing Library
and jsdom cover the synchronous root page; E2E tooling remains deferred.
The shell uses plain CSS, system light/dark preference and English copy isolated
in `src/i18n/en.ts`. Locale routing and German/Portuguese translations remain for
the localization foundation; no language preference or account functionality exists.

When running both apps, keep web on 3000 and launch the API in a separate
PowerShell terminal with its `DATABASE_URL` configured as described above:

```powershell
$env:PORT = '3001'
pnpm api:dev
```

The API's existing default remains 3000. No API connectivity is wired into the web shell.
Web ESLint uses Next's recommended rules with ESLint 9 because its current plugin
peers exclude ESLint 10. ESLint 9 is marked unsupported upstream; upgrade when
Next's plugin dependencies support ESLint 10. The `unrs-resolver` fallback install
hook is explicitly disabled; packaged native bindings passed local lint validation.

## Platform Admin Shell

`apps/admin` is the private `@church-platform/admin` Next.js App Router workspace.
It is an independent shell for future platform-level administration and currently
contains no authentication, authorization, API integration or administrative features.
From the repository root:

```sh
pnpm admin:dev
pnpm admin:typecheck
pnpm admin:test
pnpm admin:lint
pnpm admin:build
pnpm admin:start
```

Open `http://localhost:3002`. The local three-app convention is Web `3000`, API
`3001` when run alongside the web apps, and Platform Admin `3002`. The API's own
default remains `3000`; set `PORT=3001` when running all three together.

## Mobile Shell

`apps/mobile` is the Flutter application for Android and iOS. It uses Flutter
3.47.1 with Dart 3.13.1 in this development environment and remains separate
from the pnpm workspace. From the mobile directory:

```sh
cd apps/mobile
flutter pub get
flutter run
flutter analyze
flutter test
```

The shell uses Flutter's built-in Material 3 themes with system light/dark mode.
It has no API, authentication, networking, state-management or routing code yet.
iOS builds require macOS and Xcode; iOS compilation was not validated on Windows.
