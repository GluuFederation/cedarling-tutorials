FROM node:24.21.0-bookworm AS build
RUN corepack enable
WORKDIR /workspace/shared/identity-provider
COPY shared/identity-provider/package.json shared/identity-provider/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY shared/identity-provider/ ./
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS bootstrap
WORKDIR /bootstrap
COPY shared/identity-provider/scripts/setup.mjs shared/identity-provider/scripts/docker-bootstrap.mjs shared/identity-provider/scripts/import-data.mjs ./scripts/
COPY shared/identity-provider/src/slice-applications.ts ./src/
RUN mkdir /identity-config /app-config /worker-config \
    /p10-console-config /p10-api-config /p10-planner-config \
    /p10-north-config /p10-south-config /p10-auditor-config \
 && chown node:node /identity-config /app-config /worker-config \
    /p10-console-config /p10-api-config /p10-planner-config \
    /p10-north-config /p10-south-config /p10-auditor-config
USER node
ENTRYPOINT ["node", "/bootstrap/scripts/docker-bootstrap.mjs"]

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY --from=build /workspace/shared/identity-provider/package.json ./
COPY --from=build /workspace/shared/identity-provider/pnpm-lock.yaml ./
COPY --from=build /workspace/shared/identity-provider/node_modules ./node_modules
COPY --from=build /workspace/shared/identity-provider/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
