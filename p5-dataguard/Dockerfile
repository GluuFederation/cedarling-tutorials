FROM node:24.21.0-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY p5-dataguard/package.json p5-dataguard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY p5-dataguard/ ./
COPY shared/policy-store.mjs shared/policy-store.d.mts /shared/
RUN pnpm build && pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build --chown=node:node /app/.local/policy-store.cjar ./.local/policy-store.cjar
COPY --from=build /app/scripts/reset.ts ./scripts/reset.ts
COPY --from=build /app/src ./src
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
EXPOSE 17005
CMD ["node", "dist/server/main.js"]
