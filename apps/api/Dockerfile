FROM node:20-slim AS base

# Install OpenSSL required by Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Pin pnpm. Do NOT change this to an unpinned `npm install -g pnpm`.
#
# `npm install -g pnpm` installs whatever is current (pnpm 12 at the time of
# writing). That pnpm then self-switches to 8.15.0 because package.json declares
# "packageManager": "pnpm@8.15.0", so `pnpm --version` reports 8.15.0 and the
# build looks correct. It is not: under the self-switch, pnpm silently skips
# optional dependencies that declare an `engines` field.
#
# The casualty is sharp. Its platform binding @img/sharp-linux-x64 declares
# engines and gets skipped, while @img/sharp-libvips-linux-x64, which declares
# none, installs normally. sharp's own install script still runs and reports
# success, so the build passes and the API then crash-loops on boot with
# "Could not load the sharp module using the linux-x64 runtime".
#
# Verified by building this image both ways: pinned installs
# @img/sharp-linux-x64, unpinned does not. This layer rebuilds only
# occasionally, which is why a repo that had not changed suddenly stopped
# booting.
RUN npm install -g pnpm@8.15.0

WORKDIR /app

# Copy workspace manifests
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Generate Prisma client FIRST (needed for TypeScript compilation)
RUN cd apps/api && npx prisma generate

# Cache-bust ARG — increment to force a full rebuild on Railway
ARG CACHE_BUST=4

# Build shared package, then API
RUN pnpm --filter @fast-homes/shared build
RUN pnpm --filter @fast-homes/api build

EXPOSE 3001
CMD ["sh", "-c", "cd /app/apps/api && npx prisma migrate deploy && node dist/main.js"]
