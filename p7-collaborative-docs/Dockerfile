FROM node:24.14.0-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY p7-collaborative-docs/package.json p7-collaborative-docs/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p7-collaborative-docs/ ./
RUN pnpm build && pnpm prune --prod

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/.local/p7-data && chown -R node:node /app/.local
USER node
EXPOSE 3007
CMD ["node", "dist/server/main.js"]
