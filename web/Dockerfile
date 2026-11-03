# siryous AMS: one Next.js server (standalone output). Migrations run on boot; SEED_ON_EMPTY=1 fills an
# empty database with the demo agency once. Documents live in Postgres, so the machine needs no volume.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
# The demo seed (node scripts/seed.mjs) runs inside the image; it needs only pg, which the standalone
# trace already carries because pg is a server external package.
COPY --from=build /app/scripts ./scripts
# The review agents' reports for Admin > App Tests, copied in by scripts/fly-deploy.sh. Empty otherwise.
COPY --from=build /app/agent-reports ./agent-reports
USER node
EXPOSE 3000
CMD ["node", "server.js"]
