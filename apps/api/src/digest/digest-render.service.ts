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
 * Email-client constraints drive every structural choice here: 600px table
 * layout, inline styles only, no flex or grid, no external assets. The <style>
 * block carries mobile stacking and is progressive enhancement only - the mail
 * reads correctly in clients that strip it.
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

  /** Escape, then promote **segments** to bold. Used by the yesterday stats. */
  private escBold(s: string): string {
    return this.esc(s).replace(/\*\*(.+?)\*\*/g, `<b style="color:${INK};">$1</b>`);
  }

  private sectionLabel(title: string, trailing?: string, trailingColor = FAINT): string {
    return `
      <tr><td class="px" style="padding:22px 36px 10px 32px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">
          ${this.esc(title)}${trailing ? `<span style="color:${trailingColor};font-weight:600;text-transform:none;letter-spacing:0;">&nbsp;${this.esc(trailing)}</span>` : ''}
        </div>
      </td></tr>`;
  }

  private divider(): string {
    return `<tr><td class="px" style="padding:14px 36px 0 32px;"><div style="border-top:1px solid ${HAIRLINE};"></div></td></tr>`;
  }

  // ── Sections ─────────────────────────────────────────────────────────────

  private renderBigThing(b: DigestBrief): string {
    if (!b.bigThing) return '';
    const t = b.bigThing;
    const phoneBtn = t.phone
      ? `<td style="padding-left:12px;">
           <a href="tel:${this.esc(t.phone.replace(/[^0-9+]/g, ''))}" style="display:inline-block;padding:12px 18px;font-size:14px;font-weight:600;color:${TEAL_DARK};border:1px solid #99f6e4;border-radius:8px;text-decoration:none;">
             Call ${this.esc(t.phone)}
           </a>
         </td>`
      : '';

    return `
      <tr><td class="px" style="padding:26px 36px 4px 32px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${TEAL};padding-bottom:8px;">1 big thing</div>
        <div style="font-size:22px;font-weight:700;color:${INK};line-height:1.28;letter-spacing:-0.4px;">${this.esc(t.headline)}</div>
        <div style="font-size:15px;color:${BODY};line-height:1.62;padding-top:10px;">${this.esc(t.detail)}</div>
        <div style="font-size:15px;color:${BODY};line-height:1.62;padding-top:12px;">
          <b style="color:${INK};">Why it matters:</b> ${this.esc(t.whyItMatters)}
        </div>
      </td></tr>
      <tr><td class="px" style="padding:18px 36px 24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${TEAL};border-radius:8px;">
            <a href="${this.esc(t.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${this.esc(t.ctaLabel)} &rarr;</a>
          </td>
          ${phoneBtn}
        </tr></table>
      </td></tr>`;
  }

  private renderBoard(b: DigestBrief): string {
    if (!b.board.length) return '';
    const tile = (t: (typeof b.board)[number]) => {
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
    for (let i = 0; i < b.board.length; i += 3) {
      rows.push(`<tr>${b.board.slice(i, i + 3).map(tile).join('')}</tr>`);
    }

    return `
      ${this.divider()}
      <tr><td class="px" style="padding:22px 36px 4px 32px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};padding-bottom:14px;">The board</div>
      </td></tr>
      <tr><td class="px" style="padding:0 30px 8px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>
      </td></tr>`;
  }

  private renderActions(b: DigestBrief): string {
    if (!b.actions.length) return '';
    const rail = (u: DigestUrgency) =>
      u === 'critical' ? '#dc2626' : u === 'warn' ? '#f59e0b' : '#cbd5e1';

    const items = b.actions.map((a, i) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${rail(a.urgency)};">
        <tr><td style="padding:2px 0 16px 14px;">
          <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.4;">${i + 1}. ${this.esc(a.title)}</div>
          <div style="font-size:14px;color:${BODY};line-height:1.55;padding-top:3px;">${this.esc(a.detail)}</div>
          <a href="${this.esc(a.ctaUrl)}" style="font-size:13px;font-weight:600;color:${TEAL};display:inline-block;padding-top:5px;text-decoration:none;">${this.esc(a.ctaLabel)} &rarr;</a>
        </td></tr>
      </table>`).join('');

    return `
      ${this.divider()}
      <tr><td class="px" style="padding:22px 36px 6px 32px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">Do this first</div>
        <div style="font-size:13px;color:${FAINT};padding-top:4px;">Ranked by dollars at risk today.</div>
      </td></tr>
      <tr><td class="px" style="padding:12px 36px 6px 32px;">${items}</td></tr>`;
  }

  private renderWaiting(b: DigestBrief): string {
    if (!b.waiting.length) return '';
    const rows = b.waiting.map((w, i) => `
      <tr><td style="padding:13px 15px;${i < b.waiting.length - 1 ? 'border-bottom:1px solid #eef1f4;' : ''}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-size:14px;font-weight:700;color:${INK};">${this.esc(w.name)}</td>
          <td align="right" style="font-size:12px;font-weight:700;color:${PALETTE[w.urgency].accent};white-space:nowrap;">${this.esc(w.waitedLabel)}</td>
        </tr></table>
        <div style="font-size:13px;color:${MUTED};padding-top:2px;">${this.esc(w.property)} &middot; ${this.esc(w.tierLabel)}</div>
        ${w.preview ? `<div style="font-size:13px;color:#334155;padding-top:6px;font-style:italic;line-height:1.5;">"${this.esc(w.preview)}"</div>` : ''}
        <a href="${this.esc(w.url)}" style="font-size:12px;font-weight:600;color:${TEAL};display:inline-block;padding-top:6px;text-decoration:none;">Open thread &rarr;</a>
      </td></tr>`).join('');

    return `
      ${this.divider()}
      ${this.sectionLabel('Waiting on you', `${b.waitingTotal} unanswered ${b.waitingTotal === 1 ? 'reply' : 'replies'}`, '#b45309')}
      <tr><td class="px" style="padding:0 36px 6px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${HAIRLINE};border-radius:10px;">${rows}</table>
        <div style="padding-top:10px;">
          <a href="${this.esc(b.appUrl)}/inbox?filter=unread" style="font-size:13px;font-weight:600;color:${TEAL};text-decoration:none;">Open the unified inbox &rarr;</a>
        </div>
      </td></tr>`;
  }

  private renderDeals(b: DigestBrief): string {
    if (!b.dealsInMotion.length) return '';
    const rows = b.dealsInMotion.map((d, i) => {
      const last = i === b.dealsInMotion.length - 1;
      const edge = last ? '' : 'border-bottom:1px solid #eef1f4;';
      return `
        <tr>
          <td style="padding:11px 10px;${edge}">
            <div style="font-weight:600;color:${INK};"><a href="${this.esc(d.url)}" style="color:${INK};text-decoration:none;">${this.esc(d.property)}</a></div>
            <div style="color:${PALETTE[d.noteUrgency].accent};font-size:12px;font-weight:${d.noteUrgency === 'neutral' ? '400' : '600'};padding-top:2px;">${this.esc(d.note)}</div>
          </td>
          <td class="hide-sm" style="padding:11px 10px;${edge}color:#334155;">
            ${this.esc(d.closeLabel)}<br>
            <span style="color:${PALETTE[d.daysUrgency].accent};font-size:12px;font-weight:${d.daysUrgency === 'neutral' ? '400' : '600'};">${this.esc(d.daysLabel)}</span>
          </td>
          <td align="right" style="padding:11px 10px;${edge}font-weight:700;color:${INK};">${this.esc(d.fee)}</td>
        </tr>`;
    }).join('');

    return `
      ${this.divider()}
      ${this.sectionLabel('Deals in motion', `${b.dealsInMotion.length} open · ${b.dealsTotalFee} expected`)}
      <tr><td class="px" style="padding:0 36px 6px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;">
          <tr style="background:#f8fafc;">
            <th align="left" style="padding:9px 10px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${HAIRLINE};">Property</th>
            <th align="left" class="hide-sm" style="padding:9px 10px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${HAIRLINE};">Closes</th>
            <th align="right" style="padding:9px 10px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid ${HAIRLINE};">Fee</th>
          </tr>
          ${rows}
        </table>
      </td></tr>`;
  }

  private renderForeclosures(b: DigestBrief): string {
    if (!b.foreclosures.length) return '';
    const cards = b.foreclosures.map((f, i) => {
      const p = PALETTE[f.urgency];
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${p.border};border-radius:10px;background:${p.bg};${i ? 'margin-top:10px;' : ''}">
          <tr><td style="padding:13px 15px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="font-size:14px;font-weight:700;color:${INK};"><a href="${this.esc(f.url)}" style="color:${INK};text-decoration:none;">${this.esc(f.property)}</a></td>
              <td align="right" style="font-size:12px;font-weight:700;color:${p.accent};white-space:nowrap;">${this.esc(f.daysLabel)}</td>
            </tr></table>
            <div style="font-size:13px;color:${BODY};padding-top:4px;line-height:1.5;">${this.esc(f.facts)}</div>
            <div style="font-size:12px;font-weight:600;color:${p.accent};padding-top:4px;">${this.esc(f.status)}</div>
          </td></tr>
        </table>`;
    }).join('');

    const footer = (b.foreclosureIngestNote || b.foreclosureOpenTotal)
      ? `<div style="padding-top:12px;font-size:13px;color:${MUTED};line-height:1.55;">
           ${b.foreclosureIngestNote ? `<b style="color:${INK};">Overnight ingest:</b> ${this.esc(b.foreclosureIngestNote)} ` : ''}
           <a href="${this.esc(b.appUrl)}/foreclosures" style="color:${TEAL};font-weight:600;text-decoration:none;">See all ${b.foreclosureOpenTotal} open &rarr;</a>
         </div>`
      : '';

    return `
      ${this.divider()}
      ${this.sectionLabel('Foreclosure watch', 'sale dates inside 21 days')}
      <tr><td class="px" style="padding:0 36px 6px 32px;">${cards}${footer}</td></tr>`;
  }

  private renderNewLeads(b: DigestBrief): string {
    if (!b.newOvernight.length) return '';
    const rows = b.newOvernight.map((n, i) => `
      <tr><td style="padding:7px 0;${i < b.newOvernight.length - 1 ? 'border-bottom:1px solid #eef1f4;' : ''}">
        <a href="${this.esc(n.url)}" style="font-weight:600;color:${INK};text-decoration:none;">${this.esc(n.property)}</a>
        <span style="color:${MUTED};"> &middot; ${this.esc(n.meta)}</span>
        <div style="color:${PALETTE[n.noteUrgency].accent};font-size:12px;font-weight:${n.noteUrgency === 'neutral' ? '400' : '600'};padding-top:2px;">${this.esc(n.note)}</div>
      </td></tr>`).join('');

    const remainder = b.newOvernightTotal - b.newOvernight.length;
    return `
      ${this.divider()}
      ${this.sectionLabel('Came in overnight', `${b.newOvernightTotal} lead${b.newOvernightTotal === 1 ? '' : 's'}`)}
      <tr><td class="px" style="padding:0 36px 6px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">${rows}</table>
        ${remainder > 0
          ? `<div style="padding-top:10px;"><a href="${this.esc(b.appUrl)}/leads" style="font-size:13px;font-weight:600;color:${TEAL};text-decoration:none;">See the other ${remainder} &rarr;</a></div>`
          : ''}
      </td></tr>`;
  }

  private renderNews(b: DigestBrief): string {
    if (!b.news.length) return '';
    const items = b.news.map((n, i) => `
      <div style="${i ? `border-top:1px solid #eef1f4;padding-top:16px;` : ''}padding-bottom:${i === b.news.length - 1 ? '0' : '16px'};">
        <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.4;">
          <a href="${this.esc(n.url)}" style="color:${INK};text-decoration:none;">${this.esc(n.headline)}</a>
        </div>
        ${n.oneLiner ? `<div style="font-size:14px;color:${BODY};line-height:1.6;padding-top:3px;">${this.esc(n.oneLiner)}</div>` : ''}
        <div style="font-size:14px;color:${BODY};line-height:1.6;padding-top:6px;">
          <b style="color:${INK};">Why it matters:</b> ${this.esc(n.whyItMatters)}
        </div>
        <div style="font-size:12px;color:${FAINT};padding-top:5px;">${this.esc(n.source)} &middot; ${this.esc(n.publishedLabel)}</div>
      </div>`).join('');

    return `
      ${this.divider()}
      ${this.sectionLabel('Market and news', `${b.news.length} thing${b.news.length === 1 ? '' : 's'}, 40 seconds`)}
      <tr><td class="px" style="padding:0 36px 8px 36px;">${items}</td></tr>`;
  }

  private renderYesterday(b: DigestBrief): string {
    if (!b.yesterday.length) return '';
    const cells: string[] = [];
    for (let i = 0; i < b.yesterday.length; i += 2) {
      const pair = b.yesterday.slice(i, i + 2);
      cells.push(`<tr>${pair.map((s) =>
        `<td class="stack" width="50%" style="padding:4px 0;">${this.escBold(s.text)}</td>`,
      ).join('')}${pair.length === 1 ? '<td class="stack" width="50%"></td>' : ''}</tr>`);
    }

    return `
      ${this.divider()}
      <tr><td class="px" style="padding:20px 36px 24px 32px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};padding-bottom:10px;">Yesterday, by the numbers</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:${BODY};">${cells.join('')}</table>
      </td></tr>`;
  }

  // ── Entry points ─────────────────────────────────────────────────────────

  renderHtml(b: DigestBrief): string {
    const greeting = b.greetingName
      ? ` &middot; ${this.esc(b.greetingPrefix)}, ${this.esc(b.greetingName)}`
      : '';
    const market = b.marketLabel
      ? `<td align="right" class="hide-sm" style="font-size:12px;color:#99f6e4;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">${this.esc(b.marketLabel)}</td>`
      : '<td></td>';

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
    .stack { display:block !important; width:100% !important; }
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

  <tr><td class="px" style="background:${TEAL_DARK};padding:22px 36px 20px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;line-height:1.2;">Dealcore Daily Brief</td>
        ${market}
      </tr>
      <tr><td colspan="2" style="padding-top:5px;font-size:13px;color:#a7f3ec;line-height:1.4;">
        ${this.esc(b.dateLabel)} &middot; ${this.esc(b.timeLabel)}${greeting}
      </td></tr>
    </table>
  </td></tr>

  ${this.renderBigThing(b)}
  ${this.renderBoard(b)}
  ${this.renderActions(b)}
  ${this.renderWaiting(b)}
  ${this.renderDeals(b)}
  ${this.renderForeclosures(b)}
  ${this.renderNewLeads(b)}
  ${this.renderNews(b)}
  ${this.renderYesterday(b)}

  <tr><td class="px" style="background:#f8fafc;border-top:1px solid ${HAIRLINE};padding:20px 36px 24px 32px;">
    <div style="font-size:13px;color:${MUTED};line-height:1.6;">
      Generated by <b style="color:${INK};">Dealcore</b> at ${this.esc(b.timeLabel)} from your live pipeline.
    </div>
    <div style="font-size:13px;padding-top:8px;">
      <a href="${this.esc(b.appUrl)}" style="color:${TEAL};font-weight:600;text-decoration:none;">Open Dealcore</a>
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
    if (b.greetingName) out.push(`Good morning, ${b.greetingName}`);
    out.push('');

    if (b.bigThing) {
      out.push('1 BIG THING');
      out.push(b.bigThing.headline);
      out.push(b.bigThing.detail);
      out.push(`Why it matters: ${b.bigThing.whyItMatters}`);
      out.push(b.bigThing.ctaUrl);
      out.push('');
    }

    if (b.board.length) {
      out.push('THE BOARD');
      for (const t of b.board) out.push(`  ${t.label}: ${t.value} (${t.subtext})`);
      out.push('');
    }

    if (b.actions.length) {
      out.push('DO THIS FIRST');
      b.actions.forEach((a, i) => {
        out.push(`  ${i + 1}. ${a.title}`);
        out.push(`     ${a.detail}`);
        out.push(`     ${a.ctaUrl}`);
      });
      out.push('');
    }

    if (b.waiting.length) {
      out.push(`WAITING ON YOU (${b.waitingTotal})`);
      for (const w of b.waiting) {
        out.push(`  ${w.name} - ${w.property} - waiting ${w.waitedLabel}`);
        if (w.preview) out.push(`     "${w.preview}"`);
        out.push(`     ${w.url}`);
      }
      out.push('');
    }

    if (b.dealsInMotion.length) {
      out.push(`DEALS IN MOTION (${b.dealsTotalFee} expected)`);
      for (const d of b.dealsInMotion) {
        out.push(`  ${d.property} - closes ${d.closeLabel} (${d.daysLabel}) - ${d.fee}`);
        out.push(`     ${d.note}`);
      }
      out.push('');
    }

    if (b.foreclosures.length) {
      out.push('FORECLOSURE WATCH');
      for (const f of b.foreclosures) {
        out.push(`  ${f.property} - ${f.daysLabel}`);
        out.push(`     ${f.facts}`);
        out.push(`     ${f.status}`);
      }
      out.push('');
    }

    if (b.newOvernight.length) {
      out.push(`CAME IN OVERNIGHT (${b.newOvernightTotal})`);
      for (const n of b.newOvernight) {
        out.push(`  ${n.property} - ${n.meta}`);
        out.push(`     ${n.note}`);
      }
      out.push('');
    }

    if (b.news.length) {
      out.push('MARKET AND NEWS');
      for (const n of b.news) {
        out.push(`  ${n.headline}`);
        if (n.oneLiner) out.push(`     ${n.oneLiner}`);
        out.push(`     Why it matters: ${n.whyItMatters}`);
        out.push(`     ${n.source} - ${n.publishedLabel} - ${n.url}`);
      }
      out.push('');
    }

    if (b.yesterday.length) {
      out.push('YESTERDAY, BY THE NUMBERS');
      for (const s of b.yesterday) out.push(`  ${s.text.replace(/\*\*/g, '')}`);
      out.push('');
    }

    out.push(`Open Dealcore: ${b.appUrl}`);
    return out.join('\n');
  }
}
