FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ make python3 \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /workspace/p4-editorial-publishing
COPY p4-editorial-publishing/package.json p4-editorial-publishing/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p4-editorial-publishing/ ./
COPY shared/identity-provider/scripts/project-environment.mjs shared/identity-provider/scripts/project-environment.d.mts ../shared/identity-provider/scripts/
RUN pnpm build && pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=build /workspace/p4-editorial-publishing/package.json ./package.json
COPY --chown=node:node --from=build /workspace/p4-editorial-publishing/node_modules ./node_modules
COPY --chown=node:node --from=build /workspace/p4-editorial-publishing/.next ./.next
COPY --chown=node:node --from=build /workspace/p4-editorial-publishing/scripts ./scripts
COPY --chown=node:node --from=build /workspace/p4-editorial-publishing/src ./src
COPY --chown=node:node shared/dev-supervisor.mjs /shared/dev-supervisor.mjs
RUN mkdir -p /app/.local/p4-data && chown -R node:node /app/.local
USER node
EXPOSE 3004
CMD ["node", "scripts/serve.mjs"]
