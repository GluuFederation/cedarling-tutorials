FROM node:24.14.0-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY p6-field-inspection/package.json p6-field-inspection/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p6-field-inspection/ ./
RUN pnpm build && pnpm prune --prod

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/.local/p6-data && chown -R node:node /app/.local
USER node
EXPOSE 3006
CMD ["node", "dist/server/main.js"]
