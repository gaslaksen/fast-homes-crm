import { Injectable } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CompanyView {
  id: string;
  key: string;
  legalName: string;
  /** What the switcher shows: the spoken name when there is one. */
  name: string;
  modules: ModuleKey[];
}

/**
 * A lead's pipeline, from its source. Same rule as PIPELINE_SOURCES in
 * leads.service.ts: the four distress sources have their own board, and every
 * other source is a property lead. The web and mobile apps carry a copy.
 */
export function moduleForSource(source?: string | null): ModuleKey {
  switch (source) {
    case 'SURPLUS':
      return 'SURPLUS_FUNDS';
    case 'FORECLOSURE':
      return 'FORECLOSURES';
    case 'PROBATE':
      return 'PROBATE';
    case 'TAX_SALE':
      return 'TAX_SALES';
    default:
      return 'PROPERTY_LEADS';
  }
}

/** The order the pipelines appear in the menu. */
const MODULE_ORDER: ModuleKey[] = [
  'PROPERTY_LEADS',
  'FORECLOSURES',
  'PROBATE',
  'TAX_SALES',
  'SURPLUS_FUNDS',
];

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  /**
   * The companies this login can see in its account, each with the pipelines
   * it runs. Ordered by the first pipeline each company runs, so the company
   * with Property Leads comes first.
   */
  async forUser(userId: string, organizationId: string): Promise<CompanyView[]> {
    const brands = await this.prisma.brand.findMany({
      where: { organizationId, active: true, users: { some: { userId } } },
      include: { modules: { select: { module: true } } },
    });

    const rank = (m: ModuleKey) => MODULE_ORDER.indexOf(m);
    return brands
      .map((b) => ({
        id: b.id,
        key: b.key,
        legalName: b.legalName,
        name: b.shortName || b.legalName,
        modules: b.modules.map((m) => m.module).sort((a, c) => rank(a) - rank(c)),
      }))
      .sort((a, c) => {
        const first = (x: CompanyView) => (x.modules.length ? rank(x.modules[0]) : MODULE_ORDER.length);
        return first(a) - first(c) || a.name.localeCompare(c.name);
      });
  }
}
