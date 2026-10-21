FROM node:24.21.0-bookworm AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src/ ./src/
RUN pnpm build && pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/.local/p14-data && chown -R node:node /app/.local
USER node
EXPOSE 17014
CMD ["node", "dist/server/main.js"]
