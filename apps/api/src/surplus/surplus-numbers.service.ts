import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LeadSource, SurplusPersonRole } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Who a number should belong to after the move. */
export type NumberTarget =
  | { claimant: true }
  | { heirId: string }
  | { newPerson: { name: string; role?: string | null; relationship?: string | null } };

export interface NumberMove {
  moved: boolean;
  /** The person the number now belongs to; null for the claimant. */
  heirId: string | null;
  name: string;
  /** Messages and calls on this number re-filed under that person. */
  reattributed: { messages: number; calls: number };
}

type Slot = { num: string; type: string | null; dnc: string | null };

/** The last ten digits, which is how every slot stores a US number. */
function tail10(v: unknown): string | null {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.slice(-10);
}

/** Every spelling a number has in the message and call tables. */
function spellings(digits: string): string[] {
  return [digits, `1${digits}`, `+1${digits}`];
}

function pretty(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function slotsOf(row: any, first: string | null | undefined): Slot[] {
  const out: Slot[] = [];
  const nums = [first, row?.phone2, row?.phone3, row?.phone4];
  for (let i = 0; i < 4; i += 1) {
    const num = tail10(nums[i]);
    if (!num) continue;
    out.push({ num, type: row?.[`phone${i + 1}Type`] || null, dnc: row?.[`phone${i + 1}Dnc`] || null });
  }
  return out;
}

function heirSlotsOf(h: any): Slot[] {
  return slotsOf(h, h.phone1);
}

/** The four positional slots, written whole so nothing is left behind in an old slot. */
function slotData(slots: Slot[]): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (let i = 0; i < 4; i += 1) {
    data[`phone${i + 1}`] = slots[i]?.num || null;
    data[`phone${i + 1}Type`] = slots[i]?.type || null;
    data[`phone${i + 1}Dnc`] = slots[i]?.dnc || null;
  }
  return data;
}

/**
 * Moves a phone number from one person on a surplus case to another.
 *
 * Numbers were filed on the case, not on the person: a skip trace put the
 * son's cell on the father's row, the son texted back six times, and the
 * timeline logged every one as the father replying. Picking "who answered"
 * on the dialer, or "reaches someone else" on the card, lands here: the
 * number leaves the old row, lands on the new one with its line type and
 * DNC result, and the messages and calls already on that number are re-filed
 * under the right person so the thread reads true.
 */
@Injectable()
export class SurplusNumbersService {
  private readonly logger = new Logger(SurplusNumbersService.name);

  constructor(private prisma: PrismaService) {}

  async reassign(opts: {
    leadId: string;
    number: string;
    to: NumberTarget;
    userId?: string | null;
    organizationId?: string | null;
  }): Promise<NumberMove> {
    const digits = tail10(opts.number);
    if (!digits) throw new BadRequestException('That is not a phone number.');

    const lead = await this.prisma.lead.findFirst({
      where: { id: opts.leadId, source: LeadSource.SURPLUS, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) },
      select: {
        id: true,
        sellerPhone: true,
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: {
          select: {
            id: true,
            organizationId: true,
            deceased: true,
            phone1Type: true, phone1Dnc: true,
            phone2: true, phone2Type: true, phone2Dnc: true,
            phone3: true, phone3Type: true, phone3Dnc: true,
            phone4: true, phone4Type: true, phone4Dnc: true,
            heirs: {
              select: {
                id: true, name: true, deceased: true,
                phone1: true, phone1Type: true, phone1Dnc: true,
                phone2: true, phone2Type: true, phone2Dnc: true,
                phone3: true, phone3Type: true, phone3Dnc: true,
                phone4: true, phone4Type: true, phone4Dnc: true,
              },
            },
          },
        },
      },
    });
    const d = lead?.surplusDetail;
    if (!lead || !d) throw new NotFoundException('Surplus lead not found');
    const claimantName = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';

    // Where the number is today.
    const claimantSlots = slotsOf(d, lead.sellerPhone);
    let fromHeir: any = null;
    let slot: Slot | null = claimantSlots.find((s) => s.num === digits) || null;
    if (!slot) {
      for (const h of d.heirs) {
        const hit = heirSlotsOf(h).find((s) => s.num === digits);
        if (hit) {
          fromHeir = h;
          slot = hit;
          break;
        }
      }
    }
    // A number nobody on the case holds yet (typed into the dialer) still
    // lands on the person who answered it.
    const moving: Slot = slot || { num: digits, type: null, dnc: null };
    const fromName = fromHeir ? fromHeir.name : slot ? claimantName : null;

    // Where it is going.
    let toHeir: any = null;
    let toName = claimantName;
    if ('heirId' in opts.to) {
      toHeir = d.heirs.find((h) => h.id === opts.to['heirId']);
      if (!toHeir) throw new BadRequestException('That person is not on this case.');
      toName = toHeir.name;
    } else if ('newPerson' in opts.to) {
      const name = String(opts.to.newPerson?.name || '').trim();
      if (!name) throw new BadRequestException('The new person needs a name.');
      const role = String(opts.to.newPerson.role || SurplusPersonRole.RELATIVE);
      if (!(Object.values(SurplusPersonRole) as string[]).includes(role)) {
        throw new BadRequestException('Pick a role: heir, relative, neighbor, friend, or associate.');
      }
      toHeir = await this.prisma.surplusHeir.create({
        data: {
          surplusDetailId: d.id,
          organizationId: d.organizationId,
          name,
          role,
          relationship: String(opts.to.newPerson.relationship || '').trim() || null,
          sourceKind: 'manual',
          addedByUserId: opts.userId || null,
        },
      });
      toName = name;
    } else if (d.deceased) {
      throw new BadRequestException(`${claimantName} is marked deceased, so the number cannot be theirs. Pick a person on the case.`);
    }

    const same = toHeir ? fromHeir?.id === toHeir.id : !fromHeir && !!slot;
    if (same) {
      return { moved: false, heirId: toHeir?.id || null, name: toName, reattributed: { messages: 0, calls: 0 } };
    }

    // Take it off the old row.
    if (fromHeir) {
      await this.prisma.surplusHeir.update({
        where: { id: fromHeir.id },
        data: slotData(heirSlotsOf(fromHeir).filter((s) => s.num !== digits)),
      });
    } else if (slot) {
      const left = claimantSlots.filter((s) => s.num !== digits);
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { sellerPhone: left[0] ? `+1${left[0].num}` : '' },
      });
      const { phone1, ...rest } = slotData(left);
      void phone1;
      await this.prisma.surplusDetail.update({ where: { id: d.id }, data: rest });
    }

    // Put it on the new one, in the first free slot.
    if (toHeir) {
      const have = heirSlotsOf(toHeir).filter((s) => s.num !== digits);
      if (have.length >= 4) throw new BadRequestException(`${toName} already has four numbers on file.`);
      await this.prisma.surplusHeir.update({
        where: { id: toHeir.id },
        data: { ...slotData([...have, moving]), contactInfoUpdatedAt: new Date() },
      });
    } else {
      const have = claimantSlots.filter((s) => s.num !== digits);
      if (have.length >= 4) throw new BadRequestException(`${claimantName} already has four numbers on file.`);
      const next = [...have, moving];
      await this.prisma.lead.update({ where: { id: lead.id }, data: { sellerPhone: `+1${next[0].num}` } });
      const { phone1, ...rest } = slotData(next);
      void phone1;
      await this.prisma.surplusDetail.update({
        where: { id: d.id },
        data: { ...rest, contactInfoUpdatedAt: new Date() },
      });
    }

    // The thread reads true from here back: every text and call on this
    // number was with the person who holds it.
    const heirId = toHeir?.id || null;
    const nums = spellings(digits);
    const messages = await this.prisma.message.updateMany({
      where: { leadId: lead.id, OR: [{ from: { in: nums } }, { to: { in: nums } }] },
      data: { heirId },
    });
    const calls = await this.prisma.callLog.updateMany({
      where: { leadId: lead.id, OR: [{ toNumber: { in: nums } }, { fromNumber: { in: nums } }] },
      data: { heirId },
    });

    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: opts.userId || undefined,
        type: 'NUMBER_MOVED',
        description: fromName
          ? `${pretty(digits)} moved from ${fromName} to ${toName}: ${toName} is who it reaches.`
          : `${pretty(digits)} filed under ${toName}.`,
        metadata: { number: `+1${digits}`, fromHeirId: fromHeir?.id || null, toHeirId: heirId, messages: messages.count, calls: calls.count },
      },
    });
    this.logger.log(`Surplus ${lead.id}: ${pretty(digits)} moved ${fromName || 'nowhere'} -> ${toName}, ${messages.count} messages and ${calls.count} calls re-filed`);

    return { moved: true, heirId, name: toName, reattributed: { messages: messages.count, calls: calls.count } };
  }
}
