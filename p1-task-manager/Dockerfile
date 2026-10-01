FROM node:24.21.0-bookworm AS build
RUN corepack enable
WORKDIR /workspace/p1-task-manager
COPY p1-task-manager/package.json p1-task-manager/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY shared/policy-store.mjs /workspace/shared/policy-store.mjs
COPY p1-task-manager/ ./
RUN pnpm build \
    && pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production P1_PROJECT_ROOT=/app
WORKDIR /app
COPY --from=build /workspace/p1-task-manager/package.json ./
COPY --from=build /workspace/p1-task-manager/node_modules ./node_modules
COPY --from=build /workspace/p1-task-manager/dist ./dist
COPY --from=build --chown=node:node /workspace/p1-task-manager/.local/policy-store.cjar ./.local/policy-store.cjar
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
EXPOSE 17001
CMD ["node", "dist/server/main.js"]
