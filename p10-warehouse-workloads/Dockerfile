FROM node:24.21.0-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY p10-warehouse-workloads/package.json p10-warehouse-workloads/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p10-warehouse-workloads/ ./
RUN pnpm build && pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
RUN mkdir -p /app/.local/p10-data && chown -R node:node /app/.local
USER node
EXPOSE 3010 3110 3020
