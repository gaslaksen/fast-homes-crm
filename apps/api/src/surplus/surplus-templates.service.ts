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
  SurplusStage,
  SurplusTemplateKind,
  SURPLUS_TEMPLATE_KIND_LABEL,
  SurplusDocumentKind,
  SurplusDocumentStatus,
  SURPLUS_DOCUMENT_LABEL,
  SURPLUS_DOCUMENT_TEMPLATE,
  SURPLUS_LEGAL_TEMPLATE_KINDS,
  SURPLUS_RETIRED_TEMPLATE_KINDS,
  surplusDocumentAtLeast,
} from '@fast-homes/shared';
import { DIG_DEEPER_BRAND } from '../common/company.constants';
import { ruleFor } from './surplus-compliance';
import { CLAIM_STATUS_LABEL } from './surplus-classify.util';
import { relativeOutreachScript } from './surplus-name-search.util';
import { NOTARY_COVER, LIMITED_POA, DIRECTION_TO_PAY, NOTARY_PACKAGE_NAME } from './surplus-notary-package';

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
  { key: 'companyName', meaning: 'D.I.G. Deeper LLC, as filed on Sunbiz' },
  { key: 'companyShortName', meaning: 'D.I.G. Deeper, the spoken name for a script' },
  { key: 'companyAddress', meaning: 'The business address, for a document' },
  { key: 'caseNumber', meaning: "The clerk's case, file or tax deed number" },
  { key: 'parcelId', meaning: 'The parcel number (STRAP number in Lee)' },
  { key: 'saleDate', meaning: 'The date of the tax deed sale, spelled out' },
  { key: 'website', meaning: 'The company website, once there is one' },
  { key: 'websiteUrl', meaning: 'The website as a full link, from DIGDEEPER_WEBSITE_URL' },
  { key: 'sunbizLink', meaning: "The company's Florida state filing on Sunbiz, from DIGDEEPER_SUNBIZ_URL" },
  { key: 'onePagerLink', meaning: 'The one-page company overview PDF, from DIGDEEPER_ONEPAGER_URL' },
  { key: 'window', meaning: 'The decision window asked for at the close' },
  { key: 'today', meaning: "Today's date, for the top of a letter or document" },
  { key: 'claimantAddress', meaning: "The claimant's mailing address on file, one line" },
  { key: 'feeCapPct', meaning: 'The fee cap for this case as a number, from the compliance rule (blank when unconfirmed)' },
  { key: 'notaryName', meaning: 'The mobile notary on the claim, for the instruction sheet' },
  { key: 'recoveriesCount', meaning: 'How many claims have paid out, the milestone counter' },
  { key: 'referenceLine', meaning: 'The nearest consented reference with their quote, or the recoveries count, or "References available on request". Never blank.' },
  { key: 'recipientName', meaning: 'Who the letter is addressed to: the claimant, or the heir or relative chosen' },
  { key: 'recipientAddress', meaning: 'Their mailing address, one line' },
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
    name: 'Master phone script, September 2026',
    body: `Before dialing: this is good news. We are not hurting anyone, we are only helping. The whole call should feel exciting from start to finish, not just the opening. Smile, have fun with it, and let them hear that you are genuinely excited to tell them this. Keep the opening short and let them talk: ask the question and listen instead of delivering a monologue. There is a real person on the other end who needs this help.

1. OPENING (INTRO AND QUESTION)
Hi {{claimantFirstName}}, this is {{callerName}} with {{companyShortName}}. We're a company that helps track down funds and return them to the people they actually belong to. Did you have any idea there's money out there that belongs to you, or has anyone already reached out to help you recover it?

Note: pause here and let them answer. Their response tells you what you're working with: a cold lead who had no idea, or a warm lead someone else has already contacted.

2. THE REVEAL (EXCITING NEWS AND FULL CREDIBILITY)
That's exactly why I'm calling! I found some money that I believe belongs to you, or to an entity you've been a part of. I know that might sound like it's too good to be true, so let me tell you exactly who we are. We're {{companyShortName}}, you can check us out anytime at {{website}}, and I'm happy to text or email you our website and our official state filing right now so you can see it for yourself. We're only paid if and when you're paid, so there's never any cost to you out of pocket. I'm not going to ask you for a penny. And here's the exciting part: as of right now I found approximately {{surplusAmount}} that belongs to you!

Note: this is where skepticism is highest, right after they hear there's money involved, so this is where all of the Big Four get addressed together: who you are, that you're real, what it costs, and why they can trust you, before the amount lands as the exciting payoff. Deliver it like it's genuinely good news, because it is. If they hesitate, send the credibility packet from the buttons above right then.

3. THE CLOSE
I'd like to see your claim filed in the next {{window}} just to be safe. Every case is a little different, but the window to collect these funds is typically about one to three months, and if it's not collected in that time, sometimes people lose the ability to claim it at all, so I want to jump on this for you. Let me just grab your full name for the paperwork, and what's the best address to send our notary out to so we can get started?

Note: this is also where you confirm their identity, their full name and current address, since you need both to schedule the notary anyway. Asked here, it reads as normal logistics rather than a verification question up front. The urgency reasoning flows straight into the ask, no separate transition needed.

4. IF THEY NEED TIME OR AREN'T READY TO COMMIT
That's completely understandable, I'm sure you'll want to look into us and make sure we're a legitimate company. With that being said, I'm going to follow up with you in a day or two. As I mentioned, this is a time sensitive issue, and I don't want you to lose out on funds that belong to you. I want to get to work on this and have the satisfaction of putting this money back in your hands, and the chance to hand you a check in person. In the meantime I'll text or email you our website and our business filing so you can look us over and have my direct number saved. My number is {{callbackNumber}}.

Note: log a dated follow-up task immediately after this call. Do not leave it open ended.

OBJECTIONS (REFERENCE AS NEEDED)
Not part of the normal flow. Refer back to these only if one comes up.

Objection: "Who are you?"
My firm is called {{companyShortName}}. We're experts in the unclaimed funds recovery business. You can check us out online at our website, {{website}}, or I'd be happy to answer any questions you have about us.

Note: the Reveal already covers this up front, so this is a fallback if they ask again or want more. Follow immediately with the instant credibility offer: "I can text or email you our website link and our official state filing right now if that would help while we're on the phone."

Objection: "Tell me more"
I'd love to, but I can't. Since we don't charge an upfront fee, I can't disclose the exact nature of the location until I've signed a collection agreement with you. I'm sure you can understand why we both want certain guarantees in place before moving forward.

REMINDERS ON EVERY CALL
- Keep the energy and excitement up through the entire call, not just the opening. Smile and have fun with it.
- Lead with the question, not the pitch. Let them talk first.
- Address skepticism head on in the Reveal. That is the moment it is highest. Do not wait to build credibility later.
- The urgency reasoning is folded into the Close, so it reads as looking out for them.
- Stay honest and direct. Truthful positioning beats clever framing every time.
- Never disclose the fund source before the fee agreement is signed.
- Log the call outcome immediately after hanging up.
- If they hesitate, send the credibility packet right then. Do not wait for them to ask.`,
  },
  [SurplusTemplateKind.VOICEMAIL]: {
    name: 'Voicemail script, September 2026',
    body: `Hey {{claimantFirstName}}, my name is {{callerName}} with the company {{companyShortName}}. We're a legitimate funds recovery service, you can check us out at {{website}}. I found a good chunk of money that's owed to you, and I'd like to talk to you more about it over the phone. This is really good news, so please call me back as soon as you can so I can fill you in on all the details. I'm not going to ask you for any money, I don't need anything from you other than to share this good news with you. My number is {{callbackNumber}}, ask for {{callerName}}.`,
  },
  [SurplusTemplateKind.RELATIVE_SCRIPT]: {
    name: 'From the name search panel',
    body: `We have been unable to reach {{claimant}}, and our research indicates you may be a relative. {{claimant}} has unclaimed funds available. Would you pass this message along, or share a way to reach them? My number is {{callbackNumber}}. Ask for {{callerName}}.

Do not name the amount to a third party.`,
  },
  // The three letters the course's mailing library calls for. Drafts: they
  // follow the phone script's shape (honest effort, good news, no amount to a
  // third party, a number to call) and are meant to be edited in settings.
  [SurplusTemplateKind.LETTER_CLAIMANT]: {
    name: 'Draft, direct to the claimant',
    body: `{{today}}

{{recipientName}}
{{recipientAddress}}

Dear {{claimantFirstName}},

I have spent the last {{daysSearching}} days trying to reach you, and I am writing because I could not find a working phone number.

We do audit work on {{county}} County records. In the course of that work your name came up in connection with {{propertyAddress}}, and I have good news for you about it. It is not something I can explain properly in a letter, but it is real, it is time sensitive, and it costs you nothing to hear.

Please call me at {{callbackNumber}} and ask for {{callerName}}. If you would rather I call you, write your number on this letter and mail it back, or email us and I will ring you the same day.

Sincerely,

{{callerName}}
{{companyName}}
{{callbackNumber}}`,
  },
  [SurplusTemplateKind.LETTER_FAMILY]: {
    name: 'Draft, to a family member',
    body: `{{today}}

{{recipientName}}
{{recipientAddress}}

Dear {{recipientName}},

I am trying to reach {{claimant}}, and our research suggests you may be family. I apologise for writing to you out of the blue.

We do audit work on {{county}} County records, and {{claimant}} has come up in connection with a property that was sold there. There is good news waiting for them, but I have not been able to find a way to reach them directly.

Would you pass this letter along, or ask them to call me at {{callbackNumber}} and ask for {{callerName}}? If you are able to share a phone number or address for them, that would help too. This is not a sales matter and nothing is being asked of you.

With thanks,

{{callerName}}
{{companyName}}
{{callbackNumber}}`,
  },
  [SurplusTemplateKind.LETTER_ASSOCIATE]: {
    name: 'Draft, to a neighbour or associate',
    body: `{{today}}

{{recipientName}}
{{recipientAddress}}

Dear {{recipientName}},

I am trying to reach {{claimant}}, who I understand may have lived near you or been known to you. I apologise for writing to you out of the blue.

I have good news for {{claimant}} connected to a property in {{county}} County, and I have not been able to find a way to reach them directly. If you know how to get a message to them, I would be grateful if you would pass this along, or ask them to call me at {{callbackNumber}} and ask for {{callerName}}.

Nothing is being asked of you, and this is not a sales matter.

With thanks,

{{callerName}}
{{companyName}}
{{callbackNumber}}`,
  },
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

{{referenceLine}}

{{callerName}}
{{companyName}}`,
  },
  // The notary package cover, from the team's September 2026 draft. The
  // county versions (Duval, Lee) live in COUNTY_DEFAULTS and win for a
  // claim in that county.
  [SurplusTemplateKind.NOTARY_INSTRUCTIONS]: { name: NOTARY_PACKAGE_NAME, body: NOTARY_COVER.general },
  // The fee agreement ships empty: counsel writes it. The POA and the
  // direction to pay carry the team's working draft, with its own caveat
  // that Florida counsel has not reviewed it. The assignment is retired
  // (the claimant stays claimant of record) and is hidden from the list.
  [SurplusTemplateKind.DOC_FEE_AGREEMENT]: { name: '', body: '' },
  [SurplusTemplateKind.DOC_LIMITED_POA]: { name: NOTARY_PACKAGE_NAME, body: LIMITED_POA },
  [SurplusTemplateKind.DOC_ASSIGNMENT_OF_RIGHTS]: { name: '', body: '' },
  [SurplusTemplateKind.DOC_LETTER_OF_DIRECTION]: { name: NOTARY_PACKAGE_NAME, body: DIRECTION_TO_PAY.general },
  [SurplusTemplateKind.DOC_CLAIMS_CHECKLIST]: {
    name: 'Course standard set',
    body: `CLAIMS CHECKLIST

Claimant: {{claimant}}
Property: {{propertyAddress}}, {{county}} County, case {{caseNumber}}
Surplus stated in the notice: {{surplusAmount}}
Prepared: {{today}}

BEFORE THE AGREEMENT
[ ] Entitlement verified: the claimant is who the clerk noticed and nobody has a better claim
[ ] Notice date confirmed with the clerk
[ ] Title search complete, every lien on the waterfall known
[ ] Fee terms checked against the rule: {{feeTerms}}
[ ] Disclosures the rule requires are in the agreement

OUR DOCUMENTS, IN SIGNING ORDER
[ ] Contingency fee agreement (Client Recovery Services Agreement), signed at retention and put away
[ ] Notary package cover signed by the notary BEFORE the appointment is booked
[ ] General limited power of attorney, signed and notarized at the appointment
[ ] Irrevocable direction to pay surplus funds, signed and notarized (fund source disclosed here, not before)

THE COUNTY'S DOCUMENT
[ ] County claim form, completed and packaged as {{county}} County requires

FROM THE CLAIMANT
[ ] Photo ID copy
[ ] W-9
[ ] Deed or proof of ownership, if the county asks
[ ] Estate: death certificate and letters of administration
[ ] Entity: formation documents and authority to sign

FILING
[ ] Attorney required in this county? If yes, all county contact goes through the attorney
[ ] Submitted by an accepted method, tracking number recorded, signature required
[ ] County acknowledged receipt (date)
[ ] County follow-up: three weeks after filing, then monthly
[ ] Claimant update: at least monthly, whether or not there is news

DISBURSEMENT
[ ] Check received, claimant told the same day
[ ] Disbursement report itemized and signed by the claimant before funds move
[ ] Thirty-day clearing period observed
[ ] Claimant's check sent tracked, signature required
[ ] Satisfaction survey sent with the check`,
  },
};

/**
 * Built-in text that differs by county. A claim in one of these counties
 * gets this over the general default; a saved county version beats both.
 */
export const COUNTY_DEFAULTS: Partial<Record<SurplusTemplateKind, Record<string, { name: string; body: string }>>> = {
  [SurplusTemplateKind.NOTARY_INSTRUCTIONS]: {
    Duval: { name: NOTARY_PACKAGE_NAME, body: NOTARY_COVER.Duval },
    Lee: { name: NOTARY_PACKAGE_NAME, body: NOTARY_COVER.Lee },
  },
  [SurplusTemplateKind.DOC_LETTER_OF_DIRECTION]: {
    Duval: { name: NOTARY_PACKAGE_NAME, body: DIRECTION_TO_PAY.Duval },
    Lee: { name: NOTARY_PACKAGE_NAME, body: DIRECTION_TO_PAY.Lee },
  },
};

/** The county name as the built-ins spell it, or trimmed as given. Null for "every county". */
export function canonicalCounty(raw?: string | null): string | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  const known = new Set<string>();
  for (const perCounty of Object.values(COUNTY_DEFAULTS)) for (const k of Object.keys(perCounty || {})) known.add(k);
  return Array.from(known).find((k) => k.toLowerCase() === v.toLowerCase()) || v;
}

function countyDefault(kind: SurplusTemplateKind, county: string | null) {
  if (!county) return null;
  const perCounty = COUNTY_DEFAULTS[kind];
  if (!perCounty) return null;
  const key = Object.keys(perCounty).find((k) => k.toLowerCase() === county.toLowerCase());
  return key ? perCounty[key] : null;
}

/** Where a kind's active text came from, most specific first. */
export type TemplateScope = 'county' | 'county_builtin' | 'all' | 'builtin';

export interface TemplateRowLike {
  kind: string;
  county: string | null;
  version: number;
  active: boolean;
  name: string | null;
  subject: string | null;
  body: string;
  lastReviewedAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * The text a kind resolves to for a county: the county's saved version,
 * then the county's built-in, then the general saved version, then the
 * general built-in. The most specific text wins, so a county package can
 * differ from the rest without anybody re-saving every other kind.
 */
export function resolveKind(kind: SurplusTemplateKind, rows: TemplateRowLike[], county: string | null) {
  const sameCounty = (r: TemplateRowLike) =>
    !!county && !!r.county && r.county.toLowerCase() === county.toLowerCase();
  const mine = rows.filter((r) => r.kind === kind);
  const countyActive = county ? mine.find((r) => r.active && sameCounty(r)) || null : null;
  const generalActive = mine.find((r) => r.active && !r.county) || null;
  const cd = countyDefault(kind, county);
  const def = DEFAULTS[kind];
  const row = countyActive || (cd ? null : generalActive);
  const scope: TemplateScope = countyActive ? 'county' : cd ? 'county_builtin' : generalActive ? 'all' : 'builtin';
  const text = row ? { name: row.name, subject: row.subject, body: row.body } : cd ? { name: cd.name, subject: null, body: cd.body } : { name: def.name, subject: def.subject || null, body: def.body };
  return {
    row,
    scope,
    version: row ? row.version : 0,
    name: text.name,
    subject: text.subject,
    body: text.body,
    /** Saved versions in exactly this scope (the county's, or the general ones). */
    versionCount: mine.filter((r) => (county ? sameCounty(r) : !r.county)).length,
    /** A general saved version exists but is not what this county uses. */
    generalVersionShadowed: !!county && scope !== 'all' && scope !== 'builtin' && !!generalActive,
  };
}

/** Every kind, for reading rows already stored, and the live ones, for the list. */
const KINDS = Object.values(SurplusTemplateKind) as SurplusTemplateKind[];
const LIVE_KINDS = KINDS.filter((k) => !SURPLUS_RETIRED_TEMPLATE_KINDS.includes(k));

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
  /** Claims paid out, the milestone counter. */
  recoveriesCount: number;
  /** The nearest consented reference, or the count, or an offer. Never blank. */
  referenceLine: string;
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
    const active = await this.list(organizationId, built.facts.county);
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

  /**
   * The active text of every kind for a county (or in general, with no
   * county). A county's own text, saved or built-in, beats the general
   * text; the response says which it was.
   */
  async list(organizationId?: string | null, rawCounty?: string | null) {
    const county = canonicalCounty(rawCounty);
    const rows = await this.prisma.surplusTemplate.findMany({
      where: {
        organizationId: organizationId || null,
        ...(county ? { OR: [{ county: null }, { county: { equals: county, mode: 'insensitive' } }] } : { county: null }),
      },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    });
    return {
      county,
      kinds: LIVE_KINDS.map((kind) => {
        const r = resolveKind(kind, rows, county);
        return {
          kind,
          label: SURPLUS_TEMPLATE_KIND_LABEL[kind],
          version: r.version,
          name: r.name,
          subject: r.subject,
          body: r.body,
          builtIn: !r.row,
          scope: r.scope,
          /** The text shown is this county's, not the general text. */
          countySpecific: r.scope === 'county' || r.scope === 'county_builtin',
          generalVersionShadowed: r.generalVersionShadowed,
          hasText: !!r.body.trim(),
          lastReviewedAt: r.row?.lastReviewedAt || null,
          updatedAt: r.row?.updatedAt || null,
          versionCount: r.versionCount,
        };
      }),
      mergeFields: MERGE_FIELDS,
    };
  }

  async versions(organizationId: string | null | undefined, rawKind: string, rawCounty?: string | null) {
    const kind = kindOf(rawKind);
    const county = canonicalCounty(rawCounty);
    const rows = await this.prisma.surplusTemplate.findMany({
      where: {
        organizationId: organizationId || null,
        kind,
        ...(county ? { county: { equals: county, mode: 'insensitive' } } : { county: null }),
      },
      orderBy: { version: 'desc' },
    });
    const cd = countyDefault(kind, county);
    return {
      kind,
      county,
      versions: rows.map((r) => ({
        version: r.version,
        name: r.name,
        active: r.active,
        notes: r.notes,
        body: r.body,
        subject: r.subject,
        createdAt: r.createdAt,
      })),
      builtIn: cd
        ? { version: 0, name: cd.name, body: cd.body, countySpecific: true }
        : { version: 0, name: DEFAULTS[kind].name, body: DEFAULTS[kind].body, countySpecific: false },
    };
  }

  /** A new version, active, in one transaction so two actives cannot coexist. */
  async save(
    organizationId: string | null | undefined,
    rawKind: string,
    input: { body: string; name?: string; subject?: string; notes?: string; county?: string | null },
    userId?: string | null,
  ) {
    const kind = kindOf(rawKind);
    const body = String(input?.body || '').trim();
    if (!body) throw new BadRequestException('The template body is empty.');
    const org = organizationId || null;
    const county = canonicalCounty(input?.county);
    const scope = county ? { county: { equals: county, mode: 'insensitive' as const } } : { county: null };
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.surplusTemplate.findFirst({
        where: { organizationId: org, kind, ...scope },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.surplusTemplate.updateMany({
        where: { organizationId: org, kind, ...scope, active: true },
        data: { active: false },
      });
      return tx.surplusTemplate.create({
        data: {
          organizationId: org,
          kind,
          county,
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

  async activate(organizationId: string | null | undefined, rawKind: string, version: number, rawCounty?: string | null) {
    const kind = kindOf(rawKind);
    const org = organizationId || null;
    const county = canonicalCounty(rawCounty);
    const scope = county ? { county: { equals: county, mode: 'insensitive' as const } } : { county: null };
    if (!Number.isInteger(version)) throw new BadRequestException('version is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.surplusTemplate.updateMany({
        where: { organizationId: org, kind, ...scope, active: true },
        data: { active: false },
      });
      // Version 0 is the built-in: activating it means no stored version is
      // active in this scope, and the default (the county's, if it has one)
      // shows again.
      if (version === 0) return { kind, county, version: 0 };
      const target = await tx.surplusTemplate.findFirst({ where: { organizationId: org, kind, ...scope, version } });
      if (!target) throw new BadRequestException(`No version ${version} of ${kind}${county ? ` for ${county}` : ''}`);
      await tx.surplusTemplate.update({ where: { id: target.id }, data: { active: true } });
      return { kind, county, version };
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

    const active = await this.list(organizationId, facts.county);
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

  /** Active version per kind, for stamping documents and flagging stale ones. Zero is the built-in. */
  async activeVersions(organizationId?: string | null, county?: string | null): Promise<Record<string, number>> {
    const active = await this.list(organizationId, county);
    const out: Record<string, number> = {};
    for (const k of active.kinds) out[k.kind] = k.version;
    return out;
  }

  /**
   * The same, for every county the board shows at once, keyed by the
   * lower-cased county name with '' for the general set. One query.
   */
  async activeVersionsByCounty(
    organizationId?: string | null,
    counties: string[] = [],
  ): Promise<Record<string, Record<string, number>>> {
    const rows = await this.prisma.surplusTemplate.findMany({
      where: { organizationId: organizationId || null },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    });
    const forCounty = (county: string | null) => {
      const out: Record<string, number> = {};
      for (const kind of KINDS) out[kind] = resolveKind(kind, rows, county).version;
      return out;
    };
    const out: Record<string, Record<string, number>> = { '': forCounty(null) };
    for (const c of counties) out[c.toLowerCase()] = forCounty(c);
    return out;
  }

  /**
   * One of our standard documents for a claim, rendered from its template:
   * the fee agreement, the POA, the assignment, the letter of direction,
   * the notary sheet or the checklist. Same shape as a letter so the print
   * page is shared. Nothing is recorded until the person marks it drafted,
   * which stamps the version that was on the page.
   */
  async documentFor(leadId: string, rawDocKind: string, organizationId?: string | null, userId?: string | null) {
    const docKind = (Object.values(SurplusDocumentKind) as string[]).includes(rawDocKind)
      ? (rawDocKind as SurplusDocumentKind)
      : null;
    if (!docKind) throw new BadRequestException(`Unknown document kind: ${rawDocKind}`);
    const kind = SURPLUS_DOCUMENT_TEMPLATE[docKind];
    if (!kind) throw new BadRequestException(`${SURPLUS_DOCUMENT_LABEL[docKind]} is not generated from a template.`);
    const built = await this.fieldsFor(leadId, organizationId, userId);
    if (!built) return null;

    const active = await this.list(organizationId, built.facts.county);
    const t = active.kinds.find((k) => k.kind === kind)!;
    const body = renderTemplate(t.body, built.fields);
    return {
      docKind,
      kind,
      label: SURPLUS_DOCUMENT_LABEL[docKind],
      version: t.version,
      versionLabel: t.version ? `v${t.version}` : 'built-in',
      hasText: !!t.body.trim(),
      legal: SURPLUS_LEGAL_TEMPLATE_KINDS.includes(kind),
      body,
      unfilled: unfilledFields(body),
      claimant: built.facts.claimant,
      propertyAddress: built.facts.propertyAddress,
      sender: {
        companyName: DIG_DEEPER_BRAND.companyName,
        phone: DIG_DEEPER_BRAND.phone,
        website: DIG_DEEPER_BRAND.website || this.credibilityLinks().websiteUrl || null,
      },
      today: built.fields.today,
    };
  }

  /**
   * The mobile notary packet: the cover with the notary's instructions,
   * then each document the notary needs for THIS appointment, in signing
   * order, each rendered from its template with the claim's names filled in.
   *
   * What goes in follows the team's package. Until the fee agreement (the
   * Client Recovery Services Agreement) is confirmed signed, the packet
   * carries that alone and withholds the rest, because the direction to pay
   * and the county form both name the fund source and the claimant must be
   * retained before seeing it. Once retention is confirmed, the packet
   * carries the POA, the direction to pay and the county form. A team that
   * signs everything at one appointment, with the notary keeping the order,
   * can ask for the whole set.
   */
  async notaryPacket(
    leadId: string,
    opts: { includeAll?: boolean },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const built = await this.fieldsFor(leadId, organizationId, userId);
    if (!built) return null;
    const d = built.detail;
    const docs = new Map<string, any>(((d as any).documents || []).map((x: any) => [x.kind, x]));
    const at = (kind: SurplusDocumentKind, min: SurplusDocumentStatus) =>
      surplusDocumentAtLeast(docs.get(kind)?.status, min);
    const retentionConfirmed = at(SurplusDocumentKind.FEE_AGREEMENT, SurplusDocumentStatus.SIGNED);

    // The signing order, and why each is in or out of this packet.
    const order: { kind: SurplusDocumentKind; step: number; note: string }[] = [
      { kind: SurplusDocumentKind.FEE_AGREEMENT, step: 1, note: 'Signed at retention and put away before anything else is shown.' },
      { kind: SurplusDocumentKind.LIMITED_POA, step: 2, note: 'Document 1 of the package. Notarize the signature.' },
      { kind: SurplusDocumentKind.LETTER_OF_DIRECTION, step: 3, note: 'Document 2. Names the fund source. Notarize the signature.' },
      { kind: SurplusDocumentKind.COUNTY_CLAIM_FORM, step: 4, note: "Document 3. The county's own form, completed. Notarize where it calls for it; Lee needs two witnesses." },
    ];
    const active = await this.list(organizationId, built.facts.county);
    const items = [] as any[];
    for (const o of order) {
      const row = docs.get(o.kind) || null;
      const status = row?.status || SurplusDocumentStatus.OUTSTANDING;
      const alreadySigned = surplusDocumentAtLeast(status, SurplusDocumentStatus.SIGNED);
      const isRetention = o.step === 1;
      let included: boolean;
      let reason: string;
      if (opts.includeAll) {
        included = !alreadySigned;
        reason = alreadySigned ? 'Already signed, not included.' : 'Included, whole set requested.';
      } else if (!retentionConfirmed) {
        included = isRetention && !alreadySigned;
        reason = isRetention
          ? alreadySigned
            ? 'Already signed, not included.'
            : 'Included: retention comes first.'
          : 'Withheld until the fee agreement is confirmed signed.';
      } else {
        included = !isRetention && !alreadySigned;
        reason = alreadySigned ? 'Already signed, not included.' : 'Included: retention is confirmed.';
      }
      const templateKind = SURPLUS_DOCUMENT_TEMPLATE[o.kind] || null;
      const t = templateKind ? active.kinds.find((k) => k.kind === templateKind) || null : null;
      const body = included && t ? renderTemplate(t.body, built.fields) : null;
      items.push({
        step: o.step,
        kind: o.kind,
        label: SURPLUS_DOCUMENT_LABEL[o.kind],
        note: o.note,
        status,
        included,
        reason,
        templateKind,
        version: t?.version ?? null,
        versionLabel: t ? (t.version ? `v${t.version}` : 'built-in') : null,
        hasText: !!t?.body.trim(),
        body,
        unfilled: body ? unfilledFields(body) : [],
        /** The county form has no template: the stored county copy is attached instead. */
        attachCountyForm: o.kind === SurplusDocumentKind.COUNTY_CLAIM_FORM,
      });
    }

    const cover = active.kinds.find((k) => k.kind === SurplusTemplateKind.NOTARY_INSTRUCTIONS)!;
    const coverBody = renderTemplate(cover.body, {
      ...built.fields,
      notaryName: (d as any).notaryName || '____________________',
    });
    const includedNames = items.filter((i) => i.included).map((i) => `${i.step}. ${i.label}`);

    return {
      claimant: built.facts.claimant,
      propertyAddress: built.facts.propertyAddress,
      county: built.facts.county,
      retentionConfirmed,
      includeAll: !!opts.includeAll,
      notary: {
        name: (d as any).notaryName || null,
        phone: (d as any).notaryPhone || null,
        email: (d as any).notaryEmail || null,
        agreementSignedAt: (d as any).notaryAgreementSignedAt || null,
        appointmentAt: (d as any).notaryAppointmentAt || null,
        appointmentPlace: (d as any).notaryAppointmentPlace || null,
      },
      cover: {
        version: cover.version,
        versionLabel: cover.version ? `v${cover.version}` : 'built-in',
        body: coverBody,
        unfilled: unfilledFields(coverBody),
      },
      items,
      /** For the cover sheet: exactly what is in this envelope. */
      contents: includedNames,
      sender: {
        companyName: DIG_DEEPER_BRAND.companyName,
        phone: DIG_DEEPER_BRAND.phone,
        website: DIG_DEEPER_BRAND.website || this.credibilityLinks().websiteUrl || null,
      },
      today: built.fields.today,
    };
  }

  /**
   * A letter for the print view. The recipient is the claimant unless an
   * heir is named, in which case the envelope goes to the heir's own address
   * off the filing and the body still names the claimant. Nothing is
   * recorded here: the print page asks the person to confirm it was mailed.
   */
  async letterFor(
    leadId: string,
    rawKind: string,
    heirId: string | null,
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const kind = kindOf(rawKind);
    if (!String(kind).startsWith('letter_')) {
      throw new BadRequestException('That template kind is not a letter.');
    }
    const built = await this.fieldsFor(leadId, organizationId, userId);
    if (!built) return null;
    const d = built.detail;

    const heir = heirId
      ? await this.prisma.surplusHeir.findFirst({ where: { id: heirId, surplusDetailId: d.id } })
      : null;
    if (heirId && !heir) throw new BadRequestException('That heir is not on this claim.');

    const joinAddress = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');
    const recipientName = heir ? heir.name : built.facts.claimant;
    const recipientAddress = heir
      ? joinAddress([heir.street, heir.city, [heir.state, heir.zip].filter(Boolean).join(' ')])
      : joinAddress([
          d.ownerMailingStreet,
          d.ownerMailingCity,
          [d.ownerMailingState, d.ownerMailingZip].filter(Boolean).join(' '),
        ]);
    const today = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });

    const fields = { ...built.fields, recipientName, recipientAddress: recipientAddress || null, today };
    const active = await this.list(organizationId, built.facts.county);
    const t = active.kinds.find((k) => k.kind === kind)!;
    const body = renderTemplate(t.body, fields);

    return {
      kind,
      label: t.label,
      version: t.version,
      versionLabel: t.version ? `v${t.version}` : 'built-in',
      hasText: !!t.body.trim(),
      body,
      unfilled: unfilledFields(body),
      recipient: {
        heirId: heir?.id || null,
        name: recipientName,
        address: recipientAddress || null,
      },
      sender: {
        companyName: DIG_DEEPER_BRAND.companyName,
        phone: DIG_DEEPER_BRAND.phone,
        callerName: built.facts.callerName,
        website: DIG_DEEPER_BRAND.website || this.credibilityLinks().websiteUrl || null,
      },
      claimant: built.facts.claimant,
      propertyAddress: built.facts.propertyAddress,
      today,
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
        surplusDetail: { include: { documents: true } },
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
    // The milestone and the nearest consented story, for the packet. The
    // course names references as the strongest closer, so the line is never
    // blank: it degrades from a named neighbour to a count to an offer.
    const [recoveriesCount, reference] = await Promise.all([
      this.prisma.surplusDetail.count({
        where: { ...(organizationId ? { organizationId } : {}), stage: SurplusStage.PAID },
      }),
      this.prisma.surplusReference.findFirst({
        where: { ...(organizationId ? { organizationId } : {}), consented: true },
        orderBy: [{ updatedAt: 'desc' }],
        ...(d.county
          ? {
              // Same county first; Prisma cannot order by "matches", so try
              // the county and fall back below.
              where: { ...(organizationId ? { organizationId } : {}), consented: true, county: { equals: d.county, mode: 'insensitive' } },
            }
          : {}),
      }).then((r) =>
        r ||
        this.prisma.surplusReference.findFirst({
          where: { ...(organizationId ? { organizationId } : {}), consented: true },
          orderBy: [{ updatedAt: 'desc' }],
        }),
      ),
    ]);
    const referenceLine = reference
      ? `${reference.claimantName}${reference.county ? ` in ${reference.county} County` : ''} let us share their story${reference.quote ? `: "${reference.quote}"` : '.'}`
      : recoveriesCount > 0
        ? `We have completed ${recoveriesCount} recover${recoveriesCount === 1 ? 'y' : 'ies'} for Florida families.`
        : 'References available on request.';

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
      recoveriesCount,
      referenceLine,
    };
    const links = this.credibilityLinks();
    const fields: Record<string, string | number | boolean | null> = {
      ...facts,
      ...links,
      surplusAmount:
        facts.surplusAmount != null
          ? `$${Math.round(facts.surplusAmount).toLocaleString('en-US')}`
          : null,
      // A case with no number yet still has to render a document.
      caseNumber: facts.caseNumber || 'not yet assigned',
      today: new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      }),
      claimantAddress:
        [
          d.ownerMailingStreet,
          d.ownerMailingCity,
          [d.ownerMailingState, d.ownerMailingZip].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', ') || null,
      feeCapPct: facts.feeCap != null ? facts.feeCap : null,
      companyShortName: DIG_DEEPER_BRAND.shortName || DIG_DEEPER_BRAND.companyName,
      companyAddress: DIG_DEEPER_BRAND.address || null,
      parcelId: d.parcelId || null,
      saleDate: d.saleDate
        ? new Date(d.saleDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        : null,
    };
    // The bare website merge field reads as a link too once one exists.
    if (!DIG_DEEPER_BRAND.website && links.websiteUrl) fields.website = links.websiteUrl;

    return { facts, fields, detail: d };
  }
}
