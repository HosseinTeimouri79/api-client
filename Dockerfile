# syntax=docker/dockerfile:1
# --- build the React UI ---
FROM docker.arvancloud.ir/node:22-alpine AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
# the Local Agent bundle (dist/agent/agent.mjs) is built from agent/ and the shared engine in src/
COPY agent ./agent
COPY src ./src
RUN npm run build

# --- production dependencies only ---
FROM docker.arvancloud.ir/node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM docker.arvancloud.ir/node:22-alpine
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/app.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json LICENSE NOTICE ./
COPY src ./src
COPY agent/install ./agent/install
COPY --from=web /app/dist ./dist
# Local Agent installers (npm run build:installers, on a build machine): mount them here, e.g. -v ./build/installers:/installers:ro
ENV AGENT_INSTALLERS_DIR=/installers
# non-root; /data holds the SQLite database (mount a volume here)
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "src/server.js"]
