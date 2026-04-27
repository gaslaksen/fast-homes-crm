-- Disposition v2: net-new tables for plan, costs, and final sale.

CREATE TABLE "disposition_plans" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "exitStrategy" TEXT NOT NULL,
    "targetSalePrice" DOUBLE PRECISION,
    "targetCloseDate" TIMESTAMP(3),
    "jvPartnerId" TEXT,
    "jvSplitMode" TEXT,
    "jvSplitPercent" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disposition_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disposition_plans_leadId_key" ON "disposition_plans"("leadId");

ALTER TABLE "disposition_plans"
    ADD CONSTRAINT "disposition_plans_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "disposition_plans"
    ADD CONSTRAINT "disposition_plans_jvPartnerId_fkey"
    FOREIGN KEY ("jvPartnerId") REFERENCES "partners"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;


CREATE TABLE "disposition_costs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidTo" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disposition_costs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "disposition_costs_leadId_idx" ON "disposition_costs"("leadId");

ALTER TABLE "disposition_costs"
    ADD CONSTRAINT "disposition_costs_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "final_sales" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "buyerName" TEXT,
    "buyerPartnerId" TEXT,
    "finalSalePrice" DOUBLE PRECISION NOT NULL,
    "saleClosingCosts" DOUBLE PRECISION,
    "netProceeds" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "final_sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "final_sales_leadId_key" ON "final_sales"("leadId");

ALTER TABLE "final_sales"
    ADD CONSTRAINT "final_sales_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "final_sales"
    ADD CONSTRAINT "final_sales_buyerPartnerId_fkey"
    FOREIGN KEY ("buyerPartnerId") REFERENCES "partners"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
