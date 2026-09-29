FROM node:24.21.0-bookworm AS build
RUN corepack enable
WORKDIR /workspace/p3-mcp-capability-governance
COPY p3-mcp-capability-governance/package.json p3-mcp-capability-governance/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p3-mcp-capability-governance/ ./
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY --from=build /workspace/p3-mcp-capability-governance/package.json ./
COPY --from=build /workspace/p3-mcp-capability-governance/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /workspace/p3-mcp-capability-governance/dist ./dist
USER node
EXPOSE 17003
CMD ["node", "--env-file=/run/config/app.env", "dist/src/main.js"]
