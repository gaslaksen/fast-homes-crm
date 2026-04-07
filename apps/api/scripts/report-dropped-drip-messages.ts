/**
 * Read-only report: find drip enrollments that were likely affected by the
 * "advance-on-failure" bug. Prints a table; does NOT mutate anything.
 *
 * Usage (from apps/api):
 *   npx ts-node scripts/report-dropped-drip-messages.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Enrollments where the most recent message log for the most recent step
  // is FAILED — meaning the send failed but (pre-fix) the enrollment may have
  // been advanced anyway.
  const failedLogs = await prisma.campaignMessageLog.findMany({
    where: { status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
    include: {
      enrollment: {
        include: {
          lead: {
            select: {
              id: true,
              sellerFirstName: true,
              sellerLastName: true,
              sellerEmail: true,
              sellerPhone: true,
            },
          },
          campaign: { select: { id: true, name: true } },
        },
      },
      step: { select: { stepOrder: true, channel: true } },
    },
  });

  const rows = failedLogs
    .filter((log) => {
      const enrollment = log.enrollment;
      if (!enrollment) return false;
      // If the enrollment has already moved past this step's order, the
      // failed message was silently dropped.
      return enrollment.currentStepOrder >= log.step.stepOrder;
    })
    .map((log) => ({
      enrollmentId: log.enrollmentId,
      leadId: log.enrollment.leadId,
      leadName:
        `${log.enrollment.lead?.sellerFirstName ?? ''} ${log.enrollment.lead?.sellerLastName ?? ''}`.trim(),
      campaign: log.enrollment.campaign?.name,
      channel: log.step.channel,
      stepOrder: log.step.stepOrder,
      currentStepOrder: log.enrollment.currentStepOrder,
      status: log.enrollment.status,
      failedAt: log.createdAt.toISOString(),
    }));

  console.log(`Found ${rows.length} enrollment(s) with dropped messages:\n`);
  if (rows.length === 0) return;
  console.table(rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
