FROM node:24.21.0-bookworm AS build
RUN corepack enable
WORKDIR /workspace/p3-mcp-capability-governance
COPY p3-mcp-capability-governance/package.json p3-mcp-capability-governance/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY shared/policy-store.mjs shared/policy-store.d.mts /workspace/shared/
COPY p3-mcp-capability-governance/ ./
RUN pnpm build

# Refresh the generated archive volume on every Compose startup.
FROM node:24.21.0-bookworm-slim AS policy-store
COPY --from=build --chown=node:node /workspace/p3-mcp-capability-governance/.local/policy-store.cjar /artifact/policy-store.cjar
COPY --from=build /workspace/p3-mcp-capability-governance/policy-store/metadata.json /artifact/metadata.json
RUN mkdir /policy-store && chown node:node /policy-store
USER node
CMD ["node", "--input-type=module", "-e", "import {copyFileSync,readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; copyFileSync('/artifact/policy-store.cjar','/policy-store/policy-store.cjar'); const {policy_store}=JSON.parse(readFileSync('/artifact/metadata.json','utf8')); console.info('P3 Cedarling policy '+policy_store.version+' | sha256 '+createHash('sha256').update(readFileSync('/policy-store/policy-store.cjar')).digest('hex'));"]

FROM build AS production-dependencies
RUN pnpm prune --prod

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /workspace/p3-mcp-capability-governance/node_modules ./node_modules
COPY --from=build /workspace/p3-mcp-capability-governance/package.json ./
COPY --from=build /workspace/p3-mcp-capability-governance/dist ./dist
USER node
EXPOSE 17003
CMD ["node", "--env-file=/run/config/app.env", "dist/src/main.js"]
