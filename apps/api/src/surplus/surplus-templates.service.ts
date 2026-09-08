/**
 * Versioned surplus outreach wording, and the script pane's data.
 *
 * ── Why versions ───────────────────────────────────────────────────────────
 *
 * The course's instruction is to keep one script, on screen during live
 * calls, and to log which version was used per call so wording changes can be
 * tested against connect and close rates. That only works if a version number
 * names exactly one set of words forever, so saving an edit creates the next
 * version rather than overwriting, and the call log stamps the number.
 *
 * ── Why the fee comes from the compliance rule ─────────────────────────────
 *
 * The course's pitch says "split, currently 60/40". Florida caps total
 * consideration on clerk-held surplus at 12 percent under FS 45.033(3)(d),
 * and the app blocks a contract over the cap. So the script never carries a
 * typed percentage: {{feeTerms}} is filled from the rule for THIS case, and
 * where the rule has no confirmed cap the merge field says not to quote one.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadSource,
  SurplusTemplateKind,
  SURPLUS_TEMPLATE_KIND_LABEL,
} from '@fast-homes/shared';
import { DIG_DEEPER_BRAND } from '../common/company.constants';
import { ruleFor } from './surplus-compliance';
import { CLAIM_STATUS_LABEL } from './surplus-classify.util';
import { relativeOutreachScript } from './surplus-name-search.util';

/** Every merge field a template may use, with what it fills in. */
export const MERGE_FIELDS: { key: string; meaning: string }[] = [
  { key: 'claimantFirstName', meaning: "The claimant's first name" },
  { key: 'claimant', meaning: "The claimant's full name" },
  { key: 'daysSearching', meaning: 'Days since the first call attempt, or since the lead arrived. An honest number, never typed.' },
  { key: 'propertyAddress', meaning: 'The property that sold' },
  { key: 'county', meaning: 'The county' },
  { key: 'surplusAmount', meaning: 'The surplus as stated in the mailed notice. Never say it to a third party.' },
  { key: 'feeTerms', meaning: 'The fee wording for this case, from the compliance rule' },
  { key: 'callbackNumber', meaning: 'The Dig Deeper line' },
  { key: 'callerName', meaning: 'Your first name' },
  { key: 'companyName', meaning: 'Dig Deeper LLC' },
  { key: 'website', meaning: 'The company website, once there is one' },
  { key: 'websiteUrl', meaning: 'The website as a full link, from DIGDEEPER_WEBSITE_URL' },
  { key: 'sunbizLink', meaning: "The company's Florida state filing on Sunbiz, from DIGDEEPER_SUNBIZ_URL" },
  { key: 'onePagerLink', meaning: 'The one-page company overview PDF, from DIGDEEPER_ONEPAGER_URL' },
  { key: 'window', meaning: 'The decision window asked for at the close' },
];

/** What is left in a rendered body that the app could not fill. */
export function unfilledFields(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1])));
}

/**
 * Built-in version 0 of each kind: what the pane shows until somebody saves
 * an edit. The phone script is the course's editable outline filled out; the
 * voicemail is the course's exact wording. Kinds with an empty body have no
 * course text yet and the settings page says so.
 */
const DEFAULTS: Record<SurplusTemplateKind, { name: string; body: string; subject?: string }> = {
  [SurplusTemplateKind.PHONE_SCRIPT]: {
    name: 'Course outline, filled in',
    body: `OPENING
Hi, is this {{claimantFirstName}}? My name is {{callerName}} with {{companyName}}. I have spent the last {{daysSearching}} days trying to find you. Did you used to own {{propertyAddress}}? We do audit work on county records, and your name came up.

SQUEEZE (keep as scripted)
When a property sells at a county sale for more than what was owed, the extra is held by the county for the former owner. If nobody claims it inside the window, it goes to the government. That is why I have been trying to reach you.

PITCH
{{feeTerms}} There is no upfront cost to you and nothing to pay if nothing is recovered.

BIG FOUR, BEFORE THEY ASK
Who we are: {{companyName}}, a Florida company. Are we real: I am going to text you our website and our state filing so you can check us yourself while we talk. What it costs: {{feeTerms}} Can you trust us: everything I have said is in writing before you sign anything, and you can call me back on {{callbackNumber}}.

OBJECTION: WHO ARE YOU?
{{companyName}}, based in Florida. We recover funds the county is holding for former owners. Our website is {{website}}. Ask me anything you want to know.

OBJECTION: TELL ME MORE
I will tell you every detail once we have an agreement in place. That protects both of us: you know exactly what we do for you and what it costs before we go any further, and we know the work we do is for you.

CLOSE
Can we get the agreement to you in the next {{window}}? Once it is signed, I will arrange a notary to come to you at a time that suits you.

NOT READY YET
That is fine. I will send you our information so you can look us over. Can I call you back in a couple of days? My number is {{callbackNumber}}. Ask for {{callerName}}.`,
  },
  [SurplusTemplateKind.VOICEMAIL]: {
    name: 'Curiosity is killing me',
    body: `Hi {{claimantFirstName}}, you don't know me, but I've spent the last {{daysSearching}} days trying to find you. I can't say what this is about on the voicemail, but I can tell you that it's really good news, and you should call me the minute you hear this message. My number is {{callbackNumber}}. Ask for {{callerName}}.`,
  },
  [SurplusTemplateKind.RELATIVE_SCRIPT]: {
    name: 'From the name search panel',
    body: `We have been unable to reach {{claimant}}, and our research indicates you may be a relative. {{claimant}} has unclaimed funds available. Would you pass this message along, or share a way to reach them? My number is {{callbackNumber}}. Ask for {{callerName}}.

Do not name the amount to a third party.`,
  },
  [SurplusTemplateKind.LETTER_CLAIMANT]: { name: '', body: '' },
  [SurplusTemplateKind.LETTER_FAMILY]: { name: '', body: '' },
  [SurplusTemplateKind.LETTER_ASSOCIATE]: { name: '', body: '' },
  [SurplusTemplateKind.CREDIBILITY_SMS]: {
    name: 'Course packet',
    body: `{{claimantFirstName}}, this is {{callerName}} with {{companyName}}. As promised, so you can check us yourself: our website {{websiteUrl}} and our Florida state filing {{sunbizLink}}. Our one-page overview: {{onePagerLink}}. Call me back any time on {{callbackNumber}}.`,
  },
  [SurplusTemplateKind.CREDIBILITY_EMAIL]: {
    name: 'Course packet',
    subject: 'Who we are, from {{callerName}} at {{companyName}}',
    body: `Hi {{claimantFirstName}},

Thank you for taking my call. As promised, here is where you can check us out for yourself.

Website: {{websiteUrl}}
Our Florida state filing (Sunbiz): {{sunbizLink}}
One-page overview of who we are and how the fee works: {{onePagerLink}}
Phone: {{callbackNumber}}, ask for {{callerName}}

{{feeTerms}} There is no upfront cost and nothing to pay if nothing is recovered.

{{callerName}}
{{companyName}}`,
  },
  [SurplusTemplateKind.NOTARY_INSTRUCTIONS]: { name: '', body: '' },
};

const KINDS = Object.values(SurplusTemplateKind) as SurplusTemplateKind[];

function kindOf(raw: string): SurplusTemplateKind {
  if ((KINDS as string[]).includes(raw)) return raw as SurplusTemplateKind;
  throw new BadRequestException(`Unknown template kind: ${raw}`);
}

/** Fill {{fields}}. Unknown fields are left visible so a typo is seen, not blanked. */
export function renderTemplate(
  body: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    const v = fields[key];
    return v === null || v === undefined || v === '' ? m : String(v);
  });
}

export interface ScriptFacts {
  claimant: string;
  claimantFirstName: string;
  daysSearching: number;
  propertyAddress: string;
  county: string | null;
  caseNumber: string | null;
  /** The notice figure, falling back to the posted balance. */
  surplusAmount: number | null;
  claimStatus: string;
  claimStatusLabel: string;
  deceased: boolean;
  doNotCall: boolean;
  feeTerms: string;
  feeCap: number | null;
  callbackNumber: string;
  callerName: string;
  companyName: string;
  website: string;
  window: string;
}

@Injectable()
export class SurplusTemplatesService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * The links the credibility packet carries. Read from config rather than
   * the brand constants because they arrive one at a time as the website,
   * the Sunbiz record and the one-pager get made, and each is the on switch
   * for its own line.
   */
  credibilityLinks(): { websiteUrl: string | null; sunbizLink: string | null; onePagerLink: string | null } {
    const get = (k: string) => (this.config.get<string>(k) || '').trim() || null;
    return {
      websiteUrl: get('DIGDEEPER_WEBSITE_URL'),
      sunbizLink: get('DIGDEEPER_SUNBIZ_URL'),
      onePagerLink: get('DIGDEEPER_ONEPAGER_URL'),
    };
  }

  /** Whether the packet can go out at all, and what is missing if not. */
  credibilityReadiness(): { ready: boolean; missing: string[]; items: string[] } {
    const links = this.credibilityLinks();
    const missing: string[] = [];
    if (!links.websiteUrl) missing.push('DIGDEEPER_WEBSITE_URL');
    if (!links.sunbizLink) missing.push('DIGDEEPER_SUNBIZ_URL');
    if (!links.onePagerLink) missing.push('DIGDEEPER_ONEPAGER_URL');
    return {
      ready: missing.length === 0,
      missing,
      items: ['website', 'Sunbiz filing', 'one-pager', 'callback number'],
    };
  }

  /**
   * The credibility text and email for one claimant, rendered, with anything
   * the app could not fill named so the send can refuse rather than ship a
   * blank.
   */
  async credibilityFor(leadId: string, organizationId?: string | null, userId?: string | null) {
    const built = await this.fieldsFor(leadId, organizationId, userId);
    if (!built) throw new BadRequestException('Surplus lead not found');
    const readiness = this.credibilityReadiness();
    const active = await this.list(organizationId);
    const render = (kind: SurplusTemplateKind) => {
      const t = active.kinds.find((k) => k.kind === kind)!;
      const body = renderTemplate(t.body, built.fields);
      const subject = t.subject ? renderTemplate(t.subject, built.fields) : '';
      return {
        version: t.version,
        versionLabel: t.version ? `v${t.version}` : 'built-in',
        body,
        subject,
        unfilled: unfilledFields(body).concat(unfilledFields(subject)),
      };
    };
    return {
      ...readiness,
      sms: render(SurplusTemplateKind.CREDIBILITY_SMS),
      email: render(SurplusTemplateKind.CREDIBILITY_EMAIL),
    };
  }

  /** The active version of every kind, with the built-in default standing in. */
  async list(organizationId?: string | null) {
    const rows = await this.prisma.surplusTemplate.findMany({
      where: { organizationId: organizationId || null },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    });
    return {
      kinds: KINDS.map((kind) => {
        const versions = rows.filter((r) => r.kind === kind);
        const active = versions.find((r) => r.active) || null;
        const def = DEFAULTS[kind];
        return {
          kind,
          label: SURPLUS_TEMPLATE_KIND_LABEL[kind],
          version: active ? active.version : 0,
          name: active ? active.name : def.name,
          subject: active ? active.subject : def.subject || null,
          body: active ? active.body : def.body,
          builtIn: !active,
          hasText: !!(active ? active.body : def.body).trim(),
          lastReviewedAt: active?.lastReviewedAt || null,
          updatedAt: active?.updatedAt || null,
          versionCount: versions.length,
        };
      }),
      mergeFields: MERGE_FIELDS,
    };
  }

  async versions(organizationId: string | null | undefined, rawKind: string) {
    const kind = kindOf(rawKind);
    const rows = await this.prisma.surplusTemplate.findMany({
      where: { organizationId: organizationId || null, kind },
      orderBy: { version: 'desc' },
    });
    return {
      kind,
      versions: rows.map((r) => ({
        version: r.version,
        name: r.name,
        active: r.active,
        notes: r.notes,
        body: r.body,
        subject: r.subject,
        createdAt: r.createdAt,
      })),
      builtIn: { version: 0, name: DEFAULTS[kind].name, body: DEFAULTS[kind].body },
    };
  }

  /** A new version, active, in one transaction so two actives cannot coexist. */
  async save(
    organizationId: string | null | undefined,
    rawKind: string,
    input: { body: string; name?: string; subject?: string; notes?: string },
    userId?: string | null,
  ) {
    const kind = kindOf(rawKind);
    const body = String(input?.body || '').trim();
    if (!body) throw new BadRequestException('The template body is empty.');
    const org = organizationId || null;
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.surplusTemplate.findFirst({
        where: { organizationId: org, kind },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.surplusTemplate.updateMany({
        where: { organizationId: org, kind, active: true },
        data: { active: false },
      });
      return tx.surplusTemplate.create({
        data: {
          organizationId: org,
          kind,
          version: (last?.version || 0) + 1,
          name: (input.name || '').trim() || null,
          subject: (input.subject || '').trim() || null,
          body,
          notes: (input.notes || '').trim() || null,
          active: true,
          lastReviewedAt: new Date(),
          createdByUserId: userId || null,
        },
      });
    });
  }

  async activate(organizationId: string | null | undefined, rawKind: string, version: number) {
    const kind = kindOf(rawKind);
    const org = organizationId || null;
    if (!Number.isInteger(version)) throw new BadRequestException('version is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.surplusTemplate.updateMany({
        where: { organizationId: org, kind, active: true },
        data: { active: false },
      });
      // Version 0 is the built-in: activating it means no stored version is
      // active, and the default shows again.
      if (version === 0) return { kind, version: 0 };
      const target = await tx.surplusTemplate.findFirst({ where: { organizationId: org, kind, version } });
      if (!target) throw new BadRequestException(`No version ${version} of ${kind}`);
      await tx.surplusTemplate.update({ where: { id: target.id }, data: { active: true } });
      return { kind, version };
    });
  }

  /**
   * The scripts for one claimant with merge fields filled, and the facts the
   * caller needs on screen beside them.
   */
  async scriptFor(leadId: string, organizationId?: string | null, userId?: string | null) {
    const built = await this.fieldsFor(leadId, organizationId, userId);
    if (!built) return null;
    const { facts, fields, detail } = built;

    const active = await this.list(organizationId);
    const pick = (kind: SurplusTemplateKind) => {
      const t = active.kinds.find((k) => k.kind === kind)!;
      return {
        kind,
        label: t.label,
        version: t.version,
        versionLabel: t.version ? `v${t.version}` : 'built-in',
        body: renderTemplate(t.body, fields),
      };
    };

    const readiness = this.credibilityReadiness();
    return {
      facts,
      scripts: {
        phone: pick(SurplusTemplateKind.PHONE_SCRIPT),
        voicemail: pick(SurplusTemplateKind.VOICEMAIL),
        relative: pick(SurplusTemplateKind.RELATIVE_SCRIPT),
      },
      /** The panel's existing relative wording, for parity with the name-search card. */
      relativeNote: relativeOutreachScript(facts.claimant),
      /** Whether the packet can be sent from the pane, and whether it already was. */
      credibility: {
        ready: readiness.ready,
        missing: readiness.missing,
        sentAt: detail.credibilitySentAt,
        channels: detail.credibilityChannels ? String(detail.credibilityChannels).split(',') : [],
      },
    };
  }

  /** The facts and merge fields for one claimant. Shared by every renderer. */
  private async fieldsFor(leadId: string, organizationId?: string | null, userId?: string | null) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      include: {
        surplusDetail: true,
        activities: {
          where: { type: 'CALL_PLACED' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    if (!lead || !lead.surplusDetail) return null;
    const d = lead.surplusDetail;

    const caller = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } })
      : null;

    const firstAttempt = lead.activities[0]?.createdAt || lead.createdAt;
    const daysSearching = Math.max(1, Math.round((Date.now() - new Date(firstAttempt).getTime()) / 86_400_000));

    const rule = ruleFor(d.surplusType, d.fundLocation);
    const feeTerms =
      rule && rule.feeCap != null
        ? `Our fee is contingent on recovery only, and by Florida law it is capped at ${rule.feeCap} percent of the surplus.`
        : 'Do not quote a fee on this case: the fee cap for this kind of surplus is not confirmed. Say the fee is contingent on recovery and that the agreement states it.';

    const claimant = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
    const facts: ScriptFacts = {
      claimant,
      claimantFirstName: lead.sellerFirstName || claimant,
      daysSearching,
      propertyAddress: [lead.propertyAddress, lead.propertyCity].filter(Boolean).join(', '),
      county: d.county,
      caseNumber: d.caseNumber,
      surplusAmount: d.surplusAtNotice ?? d.grossSurplus ?? null,
      claimStatus: d.claimStatus || 'unknown',
      claimStatusLabel: CLAIM_STATUS_LABEL[(d.claimStatus || 'unknown') as keyof typeof CLAIM_STATUS_LABEL] || 'Unknown',
      deceased: !!(d.deceased || d.heirsRequired),
      doNotCall: !!d.doNotCall,
      feeTerms,
      feeCap: rule?.feeCap ?? null,
      callbackNumber: DIG_DEEPER_BRAND.phone,
      callerName: caller?.firstName || '',
      companyName: DIG_DEEPER_BRAND.companyName,
      website: DIG_DEEPER_BRAND.website || 'our website (coming soon)',
      window: '24 to 48 hours',
    };
    const links = this.credibilityLinks();
    const fields: Record<string, string | number | boolean | null> = {
      ...facts,
      ...links,
      surplusAmount:
        facts.surplusAmount != null
          ? `$${Math.round(facts.surplusAmount).toLocaleString('en-US')}`
          : null,
    };
    // The bare website merge field reads as a link too once one exists.
    if (!DIG_DEEPER_BRAND.website && links.websiteUrl) fields.website = links.websiteUrl;

    return { facts, fields, detail: d };
  }
}
