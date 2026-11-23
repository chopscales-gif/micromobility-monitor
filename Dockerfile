# One image for every service in the local demo (simulator, worker, web); docker-compose.yml picks the command.
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/simulator/package.json apps/simulator/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ingest/package.json packages/ingest/
COPY packages/simulator/package.json packages/simulator/
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @mm/web

EXPOSE 3000 4010
