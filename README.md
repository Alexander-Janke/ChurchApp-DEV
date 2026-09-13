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

Use `pnpm format` to format the root foundation files and this README. Existing
architecture documents are not reformatted by these scripts. Expand formatting
coverage as source packages are introduced. Prettier uses the shared
`.editorconfig` defaults; its generated lockfile is not manually formatted.

pnpm discovers actual package manifests under `apps/*`, `services/*`, and
`packages/*`. Flutter remains a separate Dart project under `apps/mobile` and
needs no Node package manifest. The current directories remain placeholders.
No additional monorepo orchestrator is required.

`tsconfig.base.json` shares strictness and casing checks only. Application
configs will choose their own module resolution, target, JSX, and output settings.
TypeScript tooling, ESLint, build, typecheck, and test scripts are deferred until
real source packages exist; there are no placeholder success commands.

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
