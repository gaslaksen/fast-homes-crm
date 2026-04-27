import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_TYPES = ['buyer', 'jv', 'title', 'lender', 'agent', 'other'] as const;
type PartnerType = (typeof ALLOWED_TYPES)[number];

function normalizeType(t: string | undefined): PartnerType {
  if (!t) return 'buyer';
  return (ALLOWED_TYPES as readonly string[]).includes(t) ? (t as PartnerType) : 'other';
}

@Injectable()
export class PartnersService {
  constructor(private prisma: PrismaService) {}

  async create(orgId: string, data: {
    name: string;
    email: string;
    company?: string;
    phone?: string;
    type?: string;
    tags?: string[];
    notes?: string;
  }) {
    const existing = await this.prisma.partner.findUnique({
      where: { organizationId_email: { organizationId: orgId, email: data.email.toLowerCase() } },
    });
    if (existing) {
      if (!existing.isActive) {
        // Reactivate soft-deleted partner
        return this.prisma.partner.update({
          where: { id: existing.id },
          data: { ...data, email: data.email.toLowerCase(), isActive: true },
        });
      }
      throw new ConflictException('A partner with this email already exists');
    }

    return this.prisma.partner.create({
      data: {
        organizationId: orgId,
        name: data.name,
        email: data.email.toLowerCase(),
        company: data.company,
        phone: data.phone,
        type: normalizeType(data.type),
        tags: data.tags || [],
        notes: data.notes,
      },
    });
  }

  async list(orgId: string, filters: {
    search?: string;
    type?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const { search, type, page = 1, limit = 50 } = filters;
    const where: any = { organizationId: orgId, isActive: true };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (type) {
      where.type = type;
    }

    const [partners, total] = await Promise.all([
      this.prisma.partner.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.partner.count({ where }),
    ]);

    return { partners, total, page, limit };
  }

  async get(orgId: string, id: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id, organizationId: orgId },
      include: {
        dealShares: {
          include: { lead: { select: { id: true, propertyAddress: true, propertyCity: true, propertyState: true, arv: true, status: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  async update(orgId: string, id: string, data: {
    name?: string;
    email?: string;
    company?: string;
    phone?: string;
    type?: string;
    tags?: string[];
    notes?: string;
    needsTypeReview?: boolean;
  }) {
    const partner = await this.prisma.partner.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    if (data.email && data.email.toLowerCase() !== partner.email) {
      const existing = await this.prisma.partner.findUnique({
        where: { organizationId_email: { organizationId: orgId, email: data.email.toLowerCase() } },
      });
      if (existing) throw new ConflictException('A partner with this email already exists');
    }

    if (data.type !== undefined && !(ALLOWED_TYPES as readonly string[]).includes(data.type)) {
      throw new BadRequestException(`Invalid partner type. Must be one of: ${ALLOWED_TYPES.join(', ')}`);
    }

    return this.prisma.partner.update({
      where: { id },
      data: {
        ...data,
        ...(data.email ? { email: data.email.toLowerCase() } : {}),
      },
    });
  }

  async delete(orgId: string, id: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    return this.prisma.partner.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
