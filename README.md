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
files remain unchanged; never commit real credentials.
