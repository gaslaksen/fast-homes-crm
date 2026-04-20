-- AlterTable: add REAPI enrichment columns to leads
ALTER TABLE "leads" ADD COLUMN "reapiId" TEXT;
ALTER TABLE "leads" ADD COLUMN "reapiEnrichedAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "reapiEstimatedValue" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN "reapiEstimatedValueLow" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN "reapiEstimatedValueHigh" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN "reapiEquity" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN "reapiMortgageData" JSONB;
ALTER TABLE "leads" ADD COLUMN "reapiSaleHistory" JSONB;
ALTER TABLE "leads" ADD COLUMN "reapiFeatures" JSONB;
ALTER TABLE "leads" ADD COLUMN "reapiOwnerData" JSONB;

-- AlterTable: change compsProvider default for new leads
ALTER TABLE "leads" ALTER COLUMN "compsProvider" SET DEFAULT 'reapi';

-- AlterTable: add PropGPT fields to comp_analyses
ALTER TABLE "comp_analyses" ADD COLUMN "propGptAnalysis" TEXT;
ALTER TABLE "comp_analyses" ADD COLUMN "propGptArv" DOUBLE PRECISION;
ALTER TABLE "comp_analyses" ADD COLUMN "propGptArvLow" DOUBLE PRECISION;
ALTER TABLE "comp_analyses" ADD COLUMN "propGptArvHigh" DOUBLE PRECISION;
ALTER TABLE "comp_analyses" ADD COLUMN "propGptConfidence" DOUBLE PRECISION;
ALTER TABLE "comp_analyses" ADD COLUMN "propGptFetchedAt" TIMESTAMP(3);
ALTER TABLE "comp_analyses" ADD COLUMN "propGptModel" TEXT;
