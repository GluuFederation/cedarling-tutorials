FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/server.js ./server.js
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/build ./build
COPY --chown=node:node --from=build /app/migrations ./migrations
COPY --chown=node:node --from=build /app/fixtures ./fixtures
USER node
EXPOSE 3011
CMD ["node", "server.js"]
