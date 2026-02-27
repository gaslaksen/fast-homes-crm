FROM node:20-slim AS base

# Install OpenSSL required by Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

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

# Build shared package, then API
RUN pnpm --filter @fast-homes/shared build
RUN pnpm --filter @fast-homes/api build

EXPOSE 3001
CMD ["sh", "-c", "cd /app/apps/api && npx prisma db push && node dist/main.js"]
