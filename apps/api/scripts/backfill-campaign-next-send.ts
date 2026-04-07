/**
 * One-shot backfill: rewrite CampaignEnrollment.nextSendAt for every active
 * enrollment using the cumulative-from-enrolledAt formula introduced in
 * commit 13ec987. The previous (buggy) code computed nextSendAt relative to
 * "now" at the moment of the previous send, so existing rows have stale
 * timestamps that the cron will otherwise wait out.
 *
 * Run from the railway shell or locally with prod DATABASE_URL exported:
 *
 *   # dry run (default — prints proposed changes, writes nothing)
 *   pnpm --filter api exec ts-node scripts/backfill-campaign-next-send.ts
 *
 *   # apply for real
 *   pnpm --filter api exec ts-node scripts/backfill-campaign-next-send.ts --apply
 *
 * The arithmetic mirrors CampaignExecutionService.calculateNextSendAt
 * (apps/api/src/campaigns/campaign-execution.service.ts) — anchor on
 * enrolledAt, add delayDays + delayHours. Send-window logic is intentionally
 * skipped here; the cron applies it on the actual fire.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

function computeNextSendAt(enrolledAt: Date, delayDays: number, delayHours: number): Date {
  const next = new Date(enrolledAt.getTime());
  next.setDate(next.getDate() + (delayDays ?? 0));
  next.setHours(next.getHours() + (delayHours ?? 0));
  return next;
}

function fmt(d: Date | null | undefined): string {
  if (!d) return '∅';
  return d.toISOString();
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}\n`);

  const enrollments = await prisma.campaignEnrollment.findMany({
    where: { status: 'ACTIVE' },
    include: {
      lead: {
        select: {
          id: true,
          sellerFirstName: true,
          sellerLastName: true,
        },
      },
      campaign: {
        select: {
          id: true,
          name: true,
          steps: { orderBy: { stepOrder: 'asc' } },
        },
      },
    },
    orderBy: { enrolledAt: 'asc' },
  });

  console.log(`Inspecting ${enrollments.length} active enrollment(s)...\n`);

  let updated = 0;
  let alreadyCorrect = 0;
  let completed = 0;
  let noNextStep = 0;

  const rows: Array<Record<string, unknown>> = [];

  for (const enrollment of enrollments) {
    const steps = enrollment.campaign.steps;
    const nextStep = steps.find(
      (s) => s.stepOrder === enrollment.currentStepOrder + 1 && s.isActive,
    );

    const leadName =
      `${enrollment.lead?.sellerFirstName ?? ''} ${enrollment.lead?.sellerLastName ?? ''}`.trim() ||
      enrollment.leadId;

    if (!nextStep) {
      // Already past the last active step — mark COMPLETED.
      noNextStep++;
      rows.push({
        enrollmentId: enrollment.id,
        lead: leadName,
        campaign: enrollment.campaign.name,
        currentStep: enrollment.currentStepOrder,
        action: 'COMPLETE',
        oldNextSendAt: fmt(enrollment.nextSendAt),
        newNextSendAt: '∅',
        deltaHours: '—',
      });
      if (APPLY) {
        await prisma.campaignEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            nextSendAt: null,
          },
        });
        completed++;
      }
      continue;
    }

    const newNextSendAt = computeNextSendAt(
      enrollment.enrolledAt,
      nextStep.delayDays ?? 0,
      nextStep.delayHours ?? 0,
    );

    const oldMs = enrollment.nextSendAt?.getTime() ?? null;
    const newMs = newNextSendAt.getTime();
    const deltaHours =
      oldMs !== null ? Math.round(((newMs - oldMs) / (1000 * 60 * 60)) * 10) / 10 : null;

    // "Close enough" — within 1 minute — counts as already correct.
    if (oldMs !== null && Math.abs(newMs - oldMs) < 60 * 1000) {
      alreadyCorrect++;
      continue;
    }

    rows.push({
      enrollmentId: enrollment.id,
      lead: leadName,
      campaign: enrollment.campaign.name,
      currentStep: `${enrollment.currentStepOrder} → ${nextStep.stepOrder}`,
      channel: nextStep.channel,
      delay: `${nextStep.delayDays}d${nextStep.delayHours ? ` ${nextStep.delayHours}h` : ''}`,
      enrolledAt: fmt(enrollment.enrolledAt),
      oldNextSendAt: fmt(enrollment.nextSendAt),
      newNextSendAt: fmt(newNextSendAt),
      deltaHours: deltaHours ?? '—',
    });

    if (APPLY) {
      await prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { nextSendAt: newNextSendAt },
      });
      updated++;
    }
  }

  if (rows.length > 0) {
    console.table(rows);
  } else {
    console.log('(no changes proposed)\n');
  }

  console.log('\nSummary:');
  console.log(`  inspected:        ${enrollments.length}`);
  console.log(`  already correct:  ${alreadyCorrect}`);
  console.log(`  no next step:     ${noNextStep}${APPLY ? ` (marked COMPLETED: ${completed})` : ''}`);
  console.log(`  ${APPLY ? 'updated:          ' : 'would update:     '}${APPLY ? updated : rows.length - noNextStep}`);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write changes.');
  } else {
    console.log('\nApplied. The next 5-minute campaign cron tick will pick up backlogged sends.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
