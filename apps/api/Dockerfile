FROM node:20-alpine AS base
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace manifests for dependency resolution
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

# Build shared package first, then API
RUN pnpm --filter @fast-homes/shared build
RUN pnpm --filter @fast-homes/api build

# Generate Prisma client
WORKDIR /app/apps/api
RUN npx prisma generate

# Expose and start
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
