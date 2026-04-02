-- CreateTable
CREATE TABLE "deal_search_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "geoIdV4" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "responseData" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "resultCount" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_search_cache_cacheKey_key" ON "deal_search_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "deal_search_cache_cacheKey_idx" ON "deal_search_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "deal_search_cache_expiresAt_idx" ON "deal_search_cache"("expiresAt");

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
