import { Injectable } from '@nestjs/common';
import { DigestBrief, DigestUrgency } from './digest.types';
import { COMPANY_NAME, COMPANY_PHONE } from '../common/company.constants';

/**
 * Turns an assembled DigestBrief into email HTML plus a plain-text fallback.
 *
 * Pure: no Prisma, no config, no clock. Hand it a fixture and you get
 * deterministic output, which is the whole point of splitting it from
 * DigestService.
 *
 * Email-client constraints drive every structural choice here: table layout,
 * inline styles only, no flex or grid, no external assets. The <style> block
 * carries mobile stacking and is progressive enhancement only; the mail reads
 * correctly in clients that strip it.
 *
 * Section order is the order of the work: the one call, the scorecard, the
 * rest of the calls, the promises owed, the files that cannot be called yet,
 * the claims already signed, what is coming, and a line for wholesaling.
 */

interface Palette {
  bg: string;
  border: string;
  label: string;
  value: string;
  accent: string;
}

const PALETTE: Record<DigestUrgency, Palette> = {
  critical: { bg: '#fef2f2', border: '#fecaca', label: '#991b1b', value: '#7f1d1d', accent: '#dc2626' },
  warn: { bg: '#fffbeb', border: '#fde68a', label: '#92400e', value: '#78350f', accent: '#b45309' },
  good: { bg: '#f0fdfa', border: '#99f6e4', label: '#0f766e', value: '#134e4a', accent: '#0d9488' },
  neutral: { bg: '#f8fafc', border: '#e6eaee', label: '#64748b', value: '#0f172a', accent: '#94a3b8' },
};

const TEAL = '#0d9488';
const TEAL_DARK = '#0f766e';
const INK = '#0f172a';
const BODY = '#475569';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const HAIRLINE = '#e6eaee';
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

@Injectable()
export class DigestRenderService {
  /** Escape anything that came out of the database before it hits the HTML. */
  private esc(s: string | null | undefined): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private tel(phone: string): string {
    return `tel:${this.esc(phone.replace(/[^0-9+]/g, ''))}`;
  }

  private sectionLabel(title: string, trailing?: string, trailingColor = FAINT): string {
    return `
      <tr><td class="px" style="padding:22px 36px 10px 36px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">
          ${this.esc(title)}${trailing ? `<span style="color:${trailingColor};font-weight:600;text-transform:none;letter-spacing:0;">&nbsp;${this.esc(trailing)}</span>` : ''}
        </div>
      </td></tr>`;
  }

  private divider(): string {
    return `<tr><td class="px" style="padding:14px 36px 0 36px;"><div style="border-top:1px solid ${HAIRLINE};"></div></td></tr>`;
  }

  private flagLine(flag: string | null | undefined, size = 13): string {
    return flag
      ? `<div style="font-size:${size}px;font-weight:700;color:#b91c1c;line-height:1.5;padding-top:6px;">${this.esc(flag)}</div>`
      : '';
  }

  // ── Sections ─────────────────────────────────────────────────────────────

  private renderBigThing(b: DigestBrief): string {
    if (!b.bigThing) return '';
    const t = b.bigThing;
    const phoneBtn = t.phone
      ? `<td style="padding-left:12px;">
           <a href="${this.tel(t.phone)}" style="display:inline-block;padding:12px 18px;font-size:14px;font-weight:600;color:${TEAL_DARK};border:1px solid #99f6e4;border-radius:8px;text-decoration:none;">
             Call ${this.esc(t.phone)}
           </a>
         </td>`
      : '';

    return `
      <tr><td class="px" style="padding:26px 36px 4px 36px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${TEAL};padding-bottom:8px;">1 big thing</div>
        <div style="font-size:22px;font-weight:700;color:${INK};line-height:1.28;letter-spacing:-0.4px;">${this.esc(t.headline)}</div>
        ${t.lines.length ? `<div style="font-size:15px;color:${BODY};line-height:1.62;padding-top:10px;">${t.lines.map((l) => this.esc(l)).join('<br>')}</div>` : ''}
        ${this.flagLine(t.flag, 14)}
        ${t.repeatNote ? `<div style="font-size:13px;font-weight:600;color:#b45309;padding-top:8px;">${this.esc(t.repeatNote)}</div>` : ''}
      </td></tr>
      <tr><td class="px" style="padding:18px 36px 24px 36px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${TEAL};border-radius:8px;">
            <a href="${this.esc(t.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${this.esc(t.ctaLabel)} &rarr;</a>
          </td>
          ${phoneBtn}
        </tr></table>
      </td></tr>`;
  }

  private renderScorecard(b: DigestBrief): string {
    if (!b.scorecard.length) return '';
    const tile = (t: (typeof b.scorecard)[number]) => {
      const p = PALETTE[t.urgency];
      return `
        <td class="tile" width="33.33%" valign="top" style="padding:0 6px 12px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${p.bg};border:1px solid ${p.border};border-radius:10px;">
            <tr><td style="padding:13px 14px;">
              <div style="font-size:11px;font-weight:600;color:${p.label};text-transform:uppercase;letter-spacing:0.5px;">${this.esc(t.label)}</div>
              <div class="num" style="font-size:28px;font-weight:700;color:${p.value};line-height:1.15;padding-top:3px;">${this.esc(t.value)}</div>
              <div style="font-size:12px;font-weight:600;color:${p.accent};padding-top:1px;">${this.esc(t.subtext)}</div>
            </td></tr>
          </table>
        </td>`;
    };

    const rows: string[] = [];
    for (let i = 0; i < b.scorecard.length; i += 3) {
      rows.push(`<tr>${b.scorecard.slice(i, i + 3).map(tile).join('')}</tr>`);
    }

    return `
      ${this.divider()}
      <tr><td class="px" style="padding:22px 36px 4px 36px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};padding-bottom:14px;">Surplus scorecard</div>
      </td></tr>
      <tr><td class="px" style="padding:0 30px 8px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>
      </td></tr>`;
  }

  private renderCalls(b: DigestBrief): string {
    if (!b.calls.length) return '';
    const rail = (u: DigestUrgency) =>
      u === 'critical' ? '#dc2626' : u === 'warn' ? '#f59e0b' : '#cbd5e1';

    const items = b.calls.map((c, i) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${rail(c.urgency)};">
        <tr><td style="padding:2px 0 16px 14px;">
          <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.4;">${i + 1}. ${this.esc(c.name)} &middot; ${this.esc(c.amount)}</div>
          <div style="font-size:14px;color:${BODY};line-height:1.55;padding-top:3px;">${this.esc(c.detail)}</div>
          ${this.flagLine(c.flag)}
          <div style="padding-top:5px;font-size:13px;font-weight:600;">
            ${c.phone ? `<a href="${this.tel(c.phone)}" style="color:${TEAL};text-decoration:none;">Call ${this.esc(c.phone)}</a> <span style="color:#cbd5e1;">&middot;</span> ` : ''}<a href="${this.esc(c.url)}" style="color:${TEAL};text-decoration:none;">Open &rarr;</a>
          </div>
        </td></tr>
      </table>`).join('');

    return `
      ${this.divider()}
      <tr><td class="px" style="padding:22px 36px 6px 36px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">${b.bigThing?.key.startsWith('surplus-person:') ? 'Then call these' : 'Call these'}</div>
        <div style="font-size:13px;color:${FAINT};padding-top:4px;">One row per person, most money first. Live number, nobody has called.</div>
      </td></tr>
      <tr><td class="px" style="padding:12px 36px 6px 36px;">${items}
        <div style="font-size:13px;"><a href="${this.esc(b.appUrl)}/surplus-funds" style="color:${TEAL};font-weight:600;text-decoration:none;">Open the full call list (${b.callsTotal}) &rarr;</a></div>
      </td></tr>`;
  }

  /** The outreach list's Due today, one line and a link. */
  private renderTouchesDue(b: DigestBrief): string {
    if (!b.touchesDue) return '';
    return `
      ${this.divider()}
      <tr><td class="px" style="padding:18px 36px 18px 36px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">Touches due today</div>
        <div style="font-size:14px;color:${BODY};line-height:1.6;padding-top:6px;">${this.esc(b.touchesDue.line)}</div>
        <div style="font-size:13px;padding-top:6px;"><a href="${this.esc(b.appUrl)}/surplus-funds/outreach?due=1" style="color:${TEAL};font-weight:600;text-decoration:none;">Open the outreach list &rarr;</a></div>
      </td></tr>`;
  }

  private renderPromises(b: DigestBrief): string {
    if (!b.promises.length) return '';
    const rows = b.promises.map((p, i) => `
      <tr><td style="padding:12px 15px;${i < b.promises.length - 1 ? 'border-bottom:1px solid #eef1f4;' : ''}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-size:14px;font-weight:700;color:${INK};line-height:1.4;"><a href="${this.esc(p.url)}" style="color:${INK};text-decoration:none;">${this.esc(p.title)}</a></td>
          <td align="right" valign="top" style="font-size:12px;font-weight:700;color:${PALETTE[p.urgency].accent};white-space:nowrap;padding-left:10px;">${this.esc(p.when)}</td>
        </tr></table>
        ${p.detail ? `<div style="font-size:13px;color:${BODY};padding-top:3px;line-height:1.5;">${this.esc(p.detail)}</div>` : ''}
      </td></tr>`).join('');
    const more = b.promisesTotal - b.promises.length;

    return `
      ${this.divider()}
      ${this.sectionLabel('Promises due', `${b.promisesTotal} owed to claimants`, '#b91c1c')}
      <tr><td class="px" style="padding:0 36px 6px 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${HAIRLINE};border-radius:10px;">${rows}</table>
        ${more > 0 ? `<div style="padding-top:10px;font-size:13px;color:${MUTED};">${more} more on the board.</div>` : ''}
      </td></tr>`;
  }

  private renderNeedsTrace(b: DigestBrief): string {
    if (!b.needsTrace) return '';
    const t = b.needsTrace;
    return `
      ${this.divider()}
      ${this.sectionLabel('Needs a skip trace')}
      <tr><td class="px" style="padding:0 36px 6px 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.warn.bg};border:1px solid ${PALETTE.warn.border};border-radius:10px;"><tr><td style="padding:13px 15px;">
          <div style="font-size:14px;font-weight:700;color:${INK};">${t.total} live claimant${t.total === 1 ? ' has' : 's have'} never been traced</div>
          <div style="font-size:13px;color:${BODY};padding-top:4px;line-height:1.5;">${this.esc(t.byCounty)}. Until they are traced they cannot reach the call list.</div>
          <a href="${this.esc(b.appUrl)}/surplus-funds" style="font-size:13px;font-weight:600;color:${TEAL};display:inline-block;padding-top:6px;text-decoration:none;">Trace them on the board &rarr;</a>
        </td></tr></table>
      </td></tr>`;
  }

  private renderInFlight(b: DigestBrief): string {
    if (!b.inFlightTotal) return '';
    const header = `${b.inFlightTotal} claim${b.inFlightTotal === 1 ? '' : 's'} · ${b.inFlightFees} in fees`;
    if (!b.inFlight.length) {
      return `
        ${this.divider()}
        ${this.sectionLabel('Claims in flight', header)}
        <tr><td class="px" style="padding:0 36px 6px 36px;font-size:14px;color:${BODY};">Nothing stuck. Every signed claim is moving.</td></tr>`;
    }
    const rows = b.inFlight.map((r, i) => {
      const edge = i === b.inFlight.length - 1 ? '' : 'border-bottom:1px solid #eef1f4;';
      return `
        <tr>
          <td style="padding:11px 10px;${edge}">
            <div style="font-weight:600;color:${INK};"><a href="${this.esc(r.url)}" style="color:${INK};text-decoration:none;">${this.esc(r.claimant)}</a></div>
            <div style="color:${PALETTE[r.urgency].accent};font-size:12px;font-weight:600;padding-top:2px;">${this.esc(r.note)}</div>
          </td>
          <td class="hide-sm" style="padding:11px 10px;${edge}color:#334155;">${this.esc(r.stage)}</td>
          <td align="right" style="padding:11px 10px;${edge}font-weight:700;color:${INK};">${this.esc(r.fee)}</td>
        </tr>`;
    }).join('');
    const th = (label: string, align: string, cls = '') =>
      `<th align="${align}"${cls ? ` class="${cls}"` : ''} style="padding:9px 10px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${HAIRLINE};">${label}</th>`;

    return `
      ${this.divider()}
      ${this.sectionLabel('Claims in flight', `${header} · ${b.inFlight.length} stuck`)}
      <tr><td class="px" style="padding:0 36px 6px 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;">
          <tr style="background:#f8fafc;">${th('Claimant', 'left')}${th('Stage', 'left', 'hide-sm')}${th('Our fee', 'right')}</tr>
          ${rows}
        </table>
      </td></tr>`;
  }

  /**
   * What is coming and whether the pulls ran. A failed or flagged feed keeps
   * its own red or amber line; the healthy ones are a single count.
   */
  private renderComingUp(b: DigestBrief): string {
    const lists = b.countyListsDue || [];
    if (!b.surplusIngestNote && !b.surplusOpeningSoonNote && !b.feedProblems.length && !b.feedSummary && !lists.length) return '';
    const para = (html: string) => `<div style="font-size:14px;color:${BODY};line-height:1.6;padding-bottom:8px;">${html}</div>`;
    const dot = (u: DigestUrgency) =>
      `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${PALETTE[u].accent};margin-right:8px;"></span>`;
    const problems = b.feedProblems.map((f) =>
      para(`${dot(f.urgency)}<b style="color:${INK};">${this.esc(f.label)}</b> <span style="color:${f.urgency === 'critical' ? PALETTE.critical.accent : BODY};">${this.esc(f.detail)}</span>`),
    ).join('');
    // The county list tracker's UPDATE DUE lines, after the feeds since both
    // are about where new claims come from.
    const listLines = lists.map((f) =>
      para(`${dot(f.urgency)}<b style="color:${INK};">${this.esc(f.label)}</b> <span style="color:${MUTED};">(${this.esc(f.schedule)})</span> ${this.esc(f.detail)}`),
    ).join('');

    return `
      ${this.divider()}
      ${this.sectionLabel('Coming up')}
      <tr><td class="px" style="padding:0 36px 6px 36px;">
        ${b.surplusOpeningSoonNote ? para(this.esc(b.surplusOpeningSoonNote)) : ''}
        ${b.surplusIngestNote ? para(`<b style="color:${INK};">Overnight:</b> ${this.esc(b.surplusIngestNote)}`) : ''}
        ${problems}
        ${b.feedSummary ? para(`${dot('good')}${this.esc(b.feedSummary)}`) : ''}
        ${listLines}
      </td></tr>`;
  }

  private renderWholesale(b: DigestBrief): string {
    if (!b.wholesale) return '';
    return `
      ${this.divider()}
      <tr><td class="px" style="padding:18px 36px 22px 36px;">
        <div style="font-size:13px;color:${MUTED};line-height:1.6;">
          <b style="color:${INK};">Wholesale, parked:</b> ${this.esc(b.wholesale)}.
          <a href="${this.esc(b.appUrl)}" style="color:${TEAL};font-weight:600;text-decoration:none;">Open Dealcore &rarr;</a>
        </div>
      </td></tr>`;
  }

  // ── Entry points ─────────────────────────────────────────────────────────

  renderHtml(b: DigestBrief): string {
    const greeting = b.greetingName
      ? ` &middot; ${this.esc(b.greetingPrefix)}, ${this.esc(b.greetingName)}`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${this.esc(b.subject)}</title>
<style>
  body { margin:0; padding:0; background:#eef1f4; -webkit-font-smoothing:antialiased; }
  a { text-decoration:none; }
  @media only screen and (max-width:700px) {
    .container { width:100% !important; }
    .px { padding-left:18px !important; padding-right:18px !important; }
    .tile { display:block !important; width:100% !important; box-sizing:border-box !important; }
    .hide-sm { display:none !important; }
    .num { font-size:26px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef1f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${this.esc(b.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f4;">
<tr><td align="center" style="padding:28px 12px 40px 12px;">
<table role="presentation" class="container" width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:${FONT};">

  <tr><td class="px" style="background:${TEAL_DARK};padding:22px 36px 20px 36px;">
    <div style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;line-height:1.2;">Dealcore Daily Brief</div>
    <div style="padding-top:5px;font-size:13px;color:#a7f3ec;line-height:1.4;">
      ${this.esc(b.dateLabel)} &middot; ${this.esc(b.timeLabel)}${greeting}
    </div>
  </td></tr>

  ${this.renderBigThing(b)}
  ${this.renderScorecard(b)}
  ${this.renderCalls(b)}
  ${this.renderTouchesDue(b)}
  ${this.renderPromises(b)}
  ${this.renderNeedsTrace(b)}
  ${this.renderInFlight(b)}
  ${this.renderComingUp(b)}
  ${this.renderWholesale(b)}

  <tr><td class="px" style="background:#f8fafc;border-top:1px solid ${HAIRLINE};padding:20px 36px 24px 36px;">
    <div style="font-size:13px;color:${MUTED};line-height:1.6;">
      Generated by <b style="color:${INK};">Dealcore</b> at ${this.esc(b.timeLabel)} from your live pipeline.
    </div>
    <div style="font-size:13px;padding-top:8px;">
      <a href="${this.esc(b.appUrl)}/surplus-funds" style="color:${TEAL};font-weight:600;text-decoration:none;">Open the surplus board</a>
    </div>
    <div style="font-size:12px;color:${FAINT};padding-top:12px;line-height:1.5;">
      ${COMPANY_NAME} &middot; ${COMPANY_PHONE} &middot; Charlotte, NC
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  /** Plain-text alternative. Same order, same priorities, no decoration. */
  renderText(b: DigestBrief): string {
    const out: string[] = [];
    out.push('DEALCORE DAILY BRIEF');
    out.push(`${b.dateLabel} - ${b.timeLabel}`);
    if (b.greetingName) out.push(`${b.greetingPrefix}, ${b.greetingName}`);
    out.push('');

    if (b.bigThing) {
      const t = b.bigThing;
      out.push('1 BIG THING');
      out.push(t.headline);
      for (const l of t.lines) out.push(`  ${l}`);
      if (t.flag) out.push(`  ${t.flag}`);
      if (t.repeatNote) out.push(`  ${t.repeatNote}`);
      if (t.phone) out.push(`  Call ${t.phone}`);
      out.push(`  ${t.ctaUrl}`);
      out.push('');
    }

    if (b.scorecard.length) {
      out.push('SURPLUS SCORECARD');
      for (const t of b.scorecard) out.push(`  ${t.label}: ${t.value} (${t.subtext})`);
      out.push('');
    }

    if (b.calls.length) {
      out.push(b.bigThing?.key.startsWith('surplus-person:') ? 'THEN CALL THESE' : 'CALL THESE');
      b.calls.forEach((c, i) => {
        out.push(`  ${i + 1}. ${c.name} - ${c.amount}`);
        out.push(`     ${c.detail}`);
        if (c.flag) out.push(`     ${c.flag}`);
        out.push(`     ${c.phone ? `Call ${c.phone} - ` : ''}${c.url}`);
      });
      out.push(`  Full call list (${b.callsTotal}): ${b.appUrl}/surplus-funds`);
      out.push('');
    }

    if (b.touchesDue) {
      out.push('TOUCHES DUE TODAY');
      out.push(`  ${b.touchesDue.line}`);
      out.push(`  Outreach list: ${b.appUrl}/surplus-funds/outreach?due=1`);
      out.push('');
    }

    if (b.promises.length) {
      out.push(`PROMISES DUE (${b.promisesTotal})`);
      for (const p of b.promises) {
        out.push(`  ${p.title} - ${p.when}`);
        if (p.detail) out.push(`     ${p.detail}`);
        out.push(`     ${p.url}`);
      }
      const more = b.promisesTotal - b.promises.length;
      if (more > 0) out.push(`  ${more} more on the board.`);
      out.push('');
    }

    if (b.needsTrace) {
      out.push('NEEDS A SKIP TRACE');
      out.push(`  ${b.needsTrace.total} live claimant${b.needsTrace.total === 1 ? ' has' : 's have'} never been traced: ${b.needsTrace.byCounty}.`);
      out.push('');
    }

    if (b.inFlightTotal) {
      out.push(`CLAIMS IN FLIGHT (${b.inFlightTotal}, ${b.inFlightFees} in fees)`);
      if (!b.inFlight.length) out.push('  Nothing stuck. Every signed claim is moving.');
      for (const r of b.inFlight) {
        out.push(`  ${r.claimant} - ${r.stage} - ${r.fee}`);
        out.push(`     ${r.note}`);
        out.push(`     ${r.url}`);
      }
      out.push('');
    }

    const lists = b.countyListsDue || [];
    if (b.surplusIngestNote || b.surplusOpeningSoonNote || b.feedProblems.length || b.feedSummary || lists.length) {
      out.push('COMING UP');
      if (b.surplusOpeningSoonNote) out.push(`  ${b.surplusOpeningSoonNote}`);
      if (b.surplusIngestNote) out.push(`  Overnight: ${b.surplusIngestNote}`);
      for (const f of b.feedProblems) out.push(`  ${f.label} (${f.schedule}): ${f.detail}`);
      if (b.feedSummary) out.push(`  ${b.feedSummary}`);
      for (const f of lists) out.push(`  ${f.label} (${f.schedule}): ${f.detail}`);
      out.push('');
    }

    if (b.wholesale) {
      out.push(`Wholesale, parked: ${b.wholesale}.`);
      out.push('');
    }

    out.push(`Open the surplus board: ${b.appUrl}/surplus-funds`);
    return out.join('\n');
  }
}
