FROM node:24.14.0-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY p14-ai-scheduling-assistant/package.json p14-ai-scheduling-assistant/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p14-ai-scheduling-assistant/ ./
RUN pnpm build && pnpm prune --prod

FROM node:24.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/.local/p14-data && chown -R node:node /app/.local
USER node
EXPOSE 3014
CMD ["node", "dist/server/main.js"]
