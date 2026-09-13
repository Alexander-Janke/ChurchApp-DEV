# syntax=docker/dockerfile:1

FROM node:24.19-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable pnpm && corepack install --global pnpm@11.19.0

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/api/package.json services/api/package.json
COPY tests/e2e/package.json tests/e2e/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .

RUN pnpm --filter @church-platform/contracts build
RUN pnpm --filter @church-platform/api build
RUN pnpm --filter @church-platform/api --prod deploy --legacy /prod/api
RUN rm -rf /prod/api/node_modules/@church-platform/contracts \
    && mkdir -p /prod/api/node_modules/@church-platform/contracts \
    && cp packages/contracts/package.json /prod/api/node_modules/@church-platform/contracts/package.json \
    && cp -R packages/contracts/dist /prod/api/node_modules/@church-platform/contracts/dist \
    && node --input-type=module -e "import { existsSync, readFileSync } from 'node:fs'; const root = '/prod/api/node_modules/@church-platform/contracts'; const pkg = JSON.parse(readFileSync(root + '/package.json', 'utf8')); const entry = pkg.exports?.['.']?.import; if (typeof entry !== 'string' || !existsSync(root + '/' + entry)) throw new Error('Contracts runtime export is missing from the deploy artifact');"

FROM node:24.19-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app

COPY --from=build --chown=node:node /prod/api/package.json ./package.json
COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/api/dist ./dist

USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
