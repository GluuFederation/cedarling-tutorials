FROM node:24-bookworm AS build
RUN corepack enable
WORKDIR /workspace/p1-task-manager
COPY p1-task-manager/package.json p1-task-manager/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p1-task-manager/ ./
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production P1_PROJECT_ROOT=/app
RUN corepack enable
WORKDIR /app
COPY --from=build /workspace/p1-task-manager/package.json ./
COPY --from=build /workspace/p1-task-manager/pnpm-lock.yaml ./
COPY --from=build /workspace/p1-task-manager/node_modules ./node_modules
COPY --from=build /workspace/p1-task-manager/dist ./dist
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "dist/server/main.js"]
