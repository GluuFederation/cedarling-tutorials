FROM node:24.21.0-bookworm AS build
RUN corepack enable
WORKDIR /workspace/p2-tenantrag
COPY p2-tenantrag/package.json p2-tenantrag/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p2-tenantrag/ ./
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production P2_PROJECT_ROOT=/app
RUN corepack enable
WORKDIR /app
COPY --from=build /workspace/p2-tenantrag/package.json ./
COPY --from=build /workspace/p2-tenantrag/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /workspace/p2-tenantrag/dist ./dist
COPY --from=build /workspace/p2-tenantrag/fixtures ./fixtures
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
