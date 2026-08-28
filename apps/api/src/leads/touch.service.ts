import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Recording that we reached out to a lead.
 *
 * Its own service, and not a method on LeadsService, so that the channels which
 * actually do the reaching can call it. The browser dialer lives in CallsModule
 * and importing LeadsModule there would close a cycle, which is why calls were
 * the one outbound channel that never recorded a touch: SMS and email both go
 * through LeadsService and calls do not. A lead could be dialled ten times and
 * still read "0 touches, last touched" the day it was imported.
 *
 * Prisma is global, so this depends on nothing else and any module can use it.
 */
@Injectable()
export class TouchService {
  constructor(private prisma: PrismaService) {}

  /**
   * One outbound touch: bump the count, stamp the time, log the activity, and
   * move a NEW lead into ATTEMPTING_CONTACT.
   *
   * Never throws. A touch is bookkeeping about a call or a message that has
   * already gone out, so failing here must not fail the thing it describes.
   */
  async record(
    leadId: string,
    type: string,
    opts?: { userId?: string; description?: string; metadata?: Record<string, any> },
  ): Promise<void> {
    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { status: true },
      });
      if (!lead) return;

      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastTouchedAt: new Date(),
          touchCount: { increment: 1 },
          ...(lead.status === 'NEW'
            ? { status: 'ATTEMPTING_CONTACT', stageChangedAt: new Date(), daysInStage: 0 }
            : {}),
        },
      });

      await this.prisma.activity.create({
        data: {
          leadId,
          userId: opts?.userId,
          type,
          description: opts?.description || type,
          metadata: opts?.metadata ?? {},
        },
      });
    } catch {
      // Deliberately swallowed. See the note above.
    }
  }
}
