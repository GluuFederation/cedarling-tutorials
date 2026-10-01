FROM node:24.21.0-bookworm AS build
RUN corepack enable
WORKDIR /workspace/p2-tenantrag
COPY p2-tenantrag/package.json p2-tenantrag/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY shared/policy-store.mjs /workspace/shared/policy-store.mjs
COPY p2-tenantrag/ ./
RUN pnpm build \
    && pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production P2_PROJECT_ROOT=/app
WORKDIR /app
COPY --from=build /workspace/p2-tenantrag/package.json ./
COPY --from=build /workspace/p2-tenantrag/node_modules ./node_modules
COPY --from=build /workspace/p2-tenantrag/dist ./dist
COPY --from=build /workspace/p2-tenantrag/fixtures ./fixtures
COPY --from=build --chown=node:node /workspace/p2-tenantrag/.local/policy-store.cjar ./.local/policy-store.cjar
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 17002
CMD ["node", "--env-file=/run/config/app.env", "dist/scripts/docker-start.js"]
