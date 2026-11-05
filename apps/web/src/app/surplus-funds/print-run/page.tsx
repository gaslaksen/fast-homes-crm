'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';
import { todayLocal } from '@/lib/dates';

/**
 * The print run, in two steps.
 *
 * 1. Choose who gets a letter. Every letter due loads as a list (nothing is
 *    rendered yet), and the team narrows it: A Tier or B Tier, claimants or
 *    relatives, first letters or follow-ups, county, net, a short window.
 *    Each filter shows how many letters it holds, and the team ticks the
 *    ones to send, or takes the top 25, 50, 100 or 200 shown.
 * 2. Review and print. Only the picked letters are rendered, each with a
 *    link to the template it came from, and one "Mailed" click records
 *    every envelope with the template version on the page and logs the
 *    postage on each claim.
 *
 * Or, on step 2, Send through Lob: Lob prints and mails the standard
 * letters (Priority stays on paper, Lob has none). With a test key Lob only
 * makes proof PDFs and nothing is recorded; with a live key each letter is
 * recorded as mailed the moment Lob takes it, and Lob's tracking lands on
 * the letter in the claim's history.
 *
 * Nothing is recorded until "Mailed". A letter that stopped being due while
 * the page was open (a reply, returned mail, another run) is left out at
 * render and named, rather than printed twice.
 */

type MailType = 'standard' | 'priority' | 'fedex';
type Rating = 'A' | 'B' | 'NONE';
type Who = 'claimant' | 'relative';
type Stage = 'first' | 'followup';
type Sort = 'board' | 'net' | 'cutoff' | 'county';

interface Envelope {
  leadId: string;
  heirId: string | null;
  claimant: string;
  recipientName: string;
  address: string;
  county: string | null;
  caseNumber: string | null;
  letterNumber: number;
  kind: string;
  kindLabel: string;
  mailType: MailType;
  why: string;
  rating: string | null;
  netToClaimant: number | null;
  daysToCutoff: number | null;
  shortWindow: boolean;
}

interface Plan {
  generatedAt: string;
  envelopes: Envelope[];
  total: number;
  cases: number;
  maxPerRun: number;
  postage: Record<MailType, number | null>;
}

interface RunLetter extends Envelope {
  label: string;
  version: number;
  versionLabel: string;
  /** Set when the letter used its county's own text, so the edit link opens that, not the all-counties text. */
  templateCounty: string | null;
  hasText: boolean;
  body: string;
  unfilled: string[];
  sender: { companyName: string; phone: string; callerName: string; website: string | null };
  propertyAddress: string;
  today: string;
}

interface Run {
  letters: RunLetter[];
  notDue: { leadId: string; heirId: string | null }[];
  postage: Record<MailType, number | null>;
}

const MAIL_TYPES: [MailType, string][] = [
  ['standard', 'Standard'],
  ['priority', 'Priority Mail'],
  ['fedex', 'FedEx'],
];

const NET_FLOORS: [number, string][] = [
  [0, 'Any amount'],
  [5000, '$5k or more'],
  [10000, '$10k or more'],
  [25000, '$25k or more'],
  [50000, '$50k or more'],
];

const TOP_PICKS = [25, 50, 100, 200];
/** Rows drawn before "Show all", so 1,600 letters do not slow the page. */
const ROWS_SHOWN = 250;

interface LobState {
  configured: boolean;
  mode: 'test' | 'live' | null;
  monthlyLimit: number | null;
  sentThisMonth: number;
  remaining: number | null;
  cost: number | null;
  returnAddress?: boolean;
}

interface LobOut {
  leadId: string;
  heirId: string | null;
  recipientName: string;
  letterNumber: number;
}

interface LobResult {
  mode: 'test' | 'live';
  sent: (LobOut & { lobLetterId: string; url: string | null; expectedDeliveryDate: string | null })[];
  heldBack: (LobOut & { reason: string })[];
  failed: (LobOut & { error: string; lobLetterId?: string | null })[];
  postageTotal: number;
}

function key(l: { leadId: string; heirId: string | null }) {
  return `${l.leadId}:${l.heirId || ''}`;
}

function ratingOf(e: Envelope): Rating {
  return e.rating === 'A' || e.rating === 'B' ? e.rating : 'NONE';
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Where the text of a letter kind is edited: the all-counties text, or a county's own when the letter used one. */
function templateHref(kind?: string | null, county?: string | null) {
  const p = new URLSearchParams();
  if (kind) p.set('kind', kind);
  if (county) p.set('county', county);
  const q = p.toString();
  return `/settings/surplus${q ? `?${q}` : ''}`;
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/** A filter button with its count. Off with nothing in it, so a dead end is visible before the click. */
function Chip({ on, count, onClick, children, tone = 'gray' }: { on: boolean; count: number; onClick: () => void; children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' }) {
  const onTone = tone === 'green' ? 'bg-green-600 border-green-600 text-white' : tone === 'amber' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-primary-600 border-primary-600 text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={!on && count === 0}
      className={`h-8 px-3 rounded-full border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
        on ? onTone : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
      <span className={`tabular-nums text-[12px] ${on ? 'opacity-90' : 'text-gray-500'}`}>{count.toLocaleString()}</span>
    </button>
  );
}

function FilterRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500" title={hint}>
        {label}
      </div>
      {children}
    </div>
  );
}

function PrintRunPage() {
  const params = useSearchParams();

  const [step, setStep] = useState<'choose' | 'review'>('choose');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The chooser. An empty set means "any".
  const [ratings, setRatings] = useState<Set<Rating>>(() => {
    const r = (params.get('rating') || '').toUpperCase();
    if (r === 'ALL') return new Set();
    if (r === 'A' || r === 'B' || r === 'NONE') return new Set([r as Rating]);
    // The team starts with A Tier; the default falls back to everyone when none are due.
    return new Set<Rating>(['A']);
  });
  const [who, setWho] = useState<Set<Who>>(new Set());
  const [stages, setStages] = useState<Set<Stage>>(new Set());
  const [mails, setMails] = useState<Set<MailType>>(new Set());
  const [county, setCounty] = useState(params.get('county') || '');
  const [netFloor, setNetFloor] = useState(0);
  const [shortOnly, setShortOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('board');
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The review.
  const [run, setRun] = useState<Run | null>(null);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [mailTypes, setMailTypes] = useState<Record<string, MailType>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [postage, setPostage] = useState<Record<MailType, string>>({ standard: '', priority: '', fedex: '' });
  const [result, setResult] = useState<{ mailed: number; postageTotal: number; failed: { recipientName: string | null; error: string }[] } | null>(null);

  // Lob. Off (no button) until the API has a secret key.
  const [lob, setLob] = useState<LobState | null>(null);
  const [lobBusy, setLobBusy] = useState(false);
  const [lobResult, setLobResult] = useState<LobResult | null>(null);
  /** Letters Lob is mailing (live key): out of the print and the Mailed click. */
  const [lobSent, setLobSent] = useState<Set<string>>(new Set());

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await surplusAPI.printRunPlan();
      const data: Plan = r.data;
      setPlan(data);
      setPostage({
        standard: data.postage.standard == null ? '' : String(data.postage.standard),
        priority: data.postage.priority == null ? '' : String(data.postage.priority),
        fedex: data.postage.fedex == null ? '' : String(data.postage.fedex),
      });
      // A Tier is the default, but not when there is no A Tier letter to send.
      setRatings((cur) => (cur.size === 1 && cur.has('A') && !data.envelopes.some((e) => e.rating === 'A') ? new Set() : cur));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The letters due could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLob = useCallback(async () => {
    try {
      const r = await surplusAPI.printRunLob();
      setLob(r.data);
    } catch {
      setLob(null);
    }
  }, []);

  useEffect(() => {
    loadPlan();
    loadLob();
  }, [loadPlan, loadLob]);

  const envelopes = useMemo(() => plan?.envelopes || [], [plan]);
  const byKey = useMemo(() => new Map(envelopes.map((e) => [key(e), e])), [envelopes]);

  /** Does the envelope pass every filter, leaving out one facet so that facet can count its own options. */
  const passes = useCallback(
    (e: Envelope, except?: 'rating' | 'who' | 'stage' | 'mail' | 'county') => {
      if (except !== 'rating' && ratings.size && !ratings.has(ratingOf(e))) return false;
      if (except !== 'who' && who.size && !who.has(e.heirId ? 'relative' : 'claimant')) return false;
      if (except !== 'stage' && stages.size && !stages.has(e.letterNumber > 1 ? 'followup' : 'first')) return false;
      if (except !== 'mail' && mails.size && !mails.has(e.mailType)) return false;
      if (except !== 'county' && county && (e.county || '') !== county) return false;
      if (netFloor && (e.netToClaimant || 0) < netFloor) return false;
      if (shortOnly && !e.shortWindow) return false;
      const q = search.trim().toLowerCase();
      if (q) {
        const hay = `${e.recipientName} ${e.claimant} ${e.caseNumber || ''} ${e.address}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    },
    [ratings, who, stages, mails, county, netFloor, shortOnly, search],
  );

  const counts = useMemo(() => {
    const c = {
      rating: { A: 0, B: 0, NONE: 0 } as Record<Rating, number>,
      who: { claimant: 0, relative: 0 } as Record<Who, number>,
      stage: { first: 0, followup: 0 } as Record<Stage, number>,
      mail: { standard: 0, priority: 0, fedex: 0 } as Record<MailType, number>,
      county: new Map<string, number>(),
    };
    for (const e of envelopes) {
      if (passes(e, 'rating')) c.rating[ratingOf(e)] += 1;
      if (passes(e, 'who')) c.who[e.heirId ? 'relative' : 'claimant'] += 1;
      if (passes(e, 'stage')) c.stage[e.letterNumber > 1 ? 'followup' : 'first'] += 1;
      if (passes(e, 'mail')) c.mail[e.mailType] += 1;
      if (passes(e, 'county') && e.county) c.county.set(e.county, (c.county.get(e.county) || 0) + 1);
    }
    return c;
  }, [envelopes, passes]);

  const shown = useMemo(() => {
    const list = envelopes.filter((e) => passes(e));
    if (sort === 'net') list.sort((a, b) => (b.netToClaimant || 0) - (a.netToClaimant || 0));
    else if (sort === 'cutoff') list.sort((a, b) => (a.daysToCutoff ?? 9999) - (b.daysToCutoff ?? 9999));
    else if (sort === 'county') list.sort((a, b) => String(a.county).localeCompare(String(b.county)) || String(a.caseNumber).localeCompare(String(b.caseNumber)));
    return list;
  }, [envelopes, passes, sort]);

  const cap = plan?.maxPerRun || 200;
  const picked = useMemo(() => envelopes.filter((e) => selected.has(key(e))), [envelopes, selected]);
  const pickedShown = shown.filter((e) => selected.has(key(e))).length;
  const allShownPicked = shown.length > 0 && pickedShown === Math.min(shown.length, cap) && shown.slice(0, cap).every((e) => selected.has(key(e)));

  const postageOf = (t: MailType): number | null => {
    const v = postage[t].trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const pickedPostage = useMemo(() => picked.reduce((s, e) => s + (postageOf(e.mailType) || 0), 0), [picked, postage]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The letter kinds in the pick (or what is shown, with nothing picked), so their text is one click away. */
  const kindsInPlay = useMemo(() => {
    const src = picked.length ? picked : shown;
    const m = new Map<string, { label: string; n: number }>();
    for (const e of src) m.set(e.kind, { label: e.kindLabel, n: (m.get(e.kind)?.n || 0) + 1 });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [picked, shown]);

  const pickTop = (n: number) => setSelected(new Set(shown.slice(0, Math.min(n, cap)).map(key)));
  const toggleAllShown = () => {
    if (allShownPicked) {
      setSelected((s) => {
        const next = new Set(s);
        for (const e of shown) next.delete(key(e));
        return next;
      });
    } else {
      setSelected((s) => {
        const next = new Set(s);
        for (const e of shown) {
          if (next.size >= cap) break;
          next.add(key(e));
        }
        return next;
      });
    }
  };
  const toggleOne = (e: Envelope) =>
    setSelected((s) => {
      const k = key(e);
      if (!s.has(k) && s.size >= cap) return s;
      return toggle(s, k);
    });

  const resetFilters = () => {
    setRatings(new Set());
    setWho(new Set());
    setStages(new Set());
    setMails(new Set());
    setCounty('');
    setNetFloor(0);
    setShortOnly(false);
    setSearch('');
  };
  const filtered = ratings.size + who.size + stages.size + mails.size > 0 || !!county || netFloor > 0 || shortOnly || !!search.trim();

  const render = async () => {
    if (!picked.length) return;
    setRendering(true);
    setError(null);
    setResult(null);
    try {
      // In the order the list showed them, so the stack comes off the printer the way it was picked.
      const order = shown.filter((e) => selected.has(key(e)));
      const rest = picked.filter((e) => !order.includes(e));
      const r = await surplusAPI.printRunRender([...order, ...rest].map((e) => ({ leadId: e.leadId, heirId: e.heirId })));
      const data: Run = r.data;
      setRun(data);
      setDropped(new Set());
      setLobResult(null);
      setLobSent(new Set());
      setMailTypes(Object.fromEntries(data.letters.map((l) => [key(l), l.mailType])));
      setTracking({});
      setStep('review');
      window.scrollTo(0, 0);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The letters could not be built.');
    } finally {
      setRendering(false);
    }
  };

  const kept = useMemo(
    () => (run ? run.letters.filter((l) => !dropped.has(key(l)) && !lobSent.has(key(l)) && l.hasText && l.unfilled.length === 0) : []),
    [run, dropped, lobSent],
  );
  /** What Lob can take: the letters going standard. Priority and FedEx stay on paper. */
  const lobSendable = useMemo(() => kept.filter((l) => (mailTypes[key(l)] || l.mailType) === 'standard'), [kept, mailTypes]);
  const lobByKey = useMemo(() => {
    const m = new Map<string, { sent?: LobResult['sent'][number]; held?: string; failed?: string }>();
    for (const x of lobResult?.sent || []) m.set(key(x), { sent: x });
    for (const x of lobResult?.heldBack || []) m.set(key(x), { held: x.reason });
    for (const x of lobResult?.failed || []) m.set(key(x), { failed: x.error });
    return m;
  }, [lobResult]);
  const unprintable = useMemo(() => (run ? run.letters.filter((l) => !l.hasText || l.unfilled.length > 0) : []), [run]);

  const estimate = useMemo(() => {
    let total = 0;
    let missing = 0;
    for (const l of kept) {
      const p = postageOf(mailTypes[key(l)] || l.mailType);
      if (p == null) missing += 1;
      else total += p;
    }
    return { total: Math.round(total * 100) / 100, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, mailTypes, postage]);

  const mailed = async () => {
    if (!run || busy || !kept.length) return;
    const n = kept.length;
    if (
      !window.confirm(
        `Record ${n} letter${n === 1 ? '' : 's'} as mailed today?\n\n` +
          `Each envelope is written to its claim with the template version on this page, a reply check is opened, and the postage ($${estimate.total.toFixed(2)}${
            estimate.missing ? `, ${estimate.missing} with no price set` : ''
          }) is logged as an expense on each claim.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await surplusAPI.printRunMailed({
        mailedAt: todayLocal(),
        postage: { standard: postageOf('standard'), priority: postageOf('priority'), fedex: postageOf('fedex') },
        items: kept.map((l) => ({
          leadId: l.leadId,
          heirId: l.heirId,
          kind: l.kind,
          version: l.version,
          recipientName: l.recipientName,
          address: l.address,
          mailType: mailTypes[key(l)] || l.mailType,
          trackingNumber: (tracking[key(l)] || '').trim() || null,
          letterNumber: l.letterNumber,
        })),
      });
      setResult(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The run could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const sendLob = async () => {
    if (!run || !lob?.configured || lobBusy || busy || !lobSendable.length) return;
    const n = lobSendable.length;
    const live = lob.mode === 'live';
    const left = kept.length - n;
    const each = lob.cost ?? 0;
    const ok = window.confirm(
      live
        ? `Mail ${n} letter${n === 1 ? '' : 's'} through Lob now?\n\n` +
            `Lob prints and mails each one First Class, black and white, at about $${each.toFixed(2)} a letter ($${(each * n).toFixed(2)}). ` +
            `Each is recorded on its claim as mailed today with the postage, and Lob's tracking lands on the letter. ` +
            `${lob.remaining ?? 0} of this month's ${lob.monthlyLimit ?? 0} are left. Lob can cancel within 4 hours from its dashboard.` +
            (left ? `\n\n${left} Priority or FedEx letter${left === 1 ? '' : 's'} stay here to print.` : '')
        : `Make ${n} Lob test proof${n === 1 ? '' : 's'}?\n\nThe key on the API is a TEST key: Lob renders each letter as a PDF to check and mails nothing. Nothing is recorded on the claims.`,
    );
    if (!ok) return;
    setLobBusy(true);
    setError(null);
    try {
      const r = await surplusAPI.printRunSendLob(lobSendable.map((l) => ({ leadId: l.leadId, heirId: l.heirId })));
      const data: LobResult = r.data;
      setLobResult(data);
      if (data.mode === 'live') {
        setLobSent((s) => {
          const next = new Set(s);
          for (const x of data.sent) next.add(key(x));
          for (const x of data.failed) if (x.lobLetterId) next.add(key(x));
          return next;
        });
        loadLob();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Lob could not be reached. Nothing was sent.');
    } finally {
      setLobBusy(false);
    }
  };

  const nextRun = async () => {
    setRun(null);
    setResult(null);
    setLobResult(null);
    setLobSent(new Set());
    setSelected(new Set());
    setStep('choose');
    await loadPlan();
  };

  const toggleDrop = (l: RunLetter) => setDropped((s) => toggle(s, key(l)));
  const notDueNames = (run?.notDue || []).map((n) => byKey.get(key(n))?.recipientName || 'a letter');

  // ── Step 1: choose who gets a letter ─────────────────────────────────────
  if (step === 'choose') {
    const countyOptions = Array.from(counts.county.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const rows = showAll ? shown : shown.slice(0, ROWS_SHOWN);
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-6xl mx-auto flex flex-wrap items-start gap-3">
            <div>
              <a href="/surplus-funds" className="text-sm text-gray-500 hover:text-gray-700">
                ← Surplus Funds
              </a>
              <h1 className="text-xl font-semibold text-gray-900 mt-1">Print run</h1>
              <p className="text-sm text-gray-600 mt-0.5">
                {plan
                  ? `${plan.total.toLocaleString()} letter${plan.total === 1 ? '' : 's'} due across ${plan.cases.toLocaleString()} case${plan.cases === 1 ? '' : 's'}. Narrow it down, tick who gets one, then review and print.`
                  : 'Loading the letters due...'}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <a
                href={templateHref('letter_claimant')}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3 inline-flex items-center rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Edit letter templates ↗
              </a>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 mt-5 space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* The filters. Each count is how many letters that choice would show, given the others. */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <FilterRow label="Rating" hint="Grok's docket review: A is work it, B has a claim on file that may be denied.">
              <Chip on={ratings.has('A')} count={counts.rating.A} onClick={() => setRatings((s) => toggle(s, 'A'))} tone="green">
                A Tier
              </Chip>
              <Chip on={ratings.has('B')} count={counts.rating.B} onClick={() => setRatings((s) => toggle(s, 'B'))} tone="amber">
                B Tier
              </Chip>
              <Chip on={ratings.has('NONE')} count={counts.rating.NONE} onClick={() => setRatings((s) => toggle(s, 'NONE'))}>
                Not rated
              </Chip>
            </FilterRow>
            <FilterRow label="Who">
              <Chip on={who.has('claimant')} count={counts.who.claimant} onClick={() => setWho((s) => toggle(s, 'claimant'))}>
                Claimants
              </Chip>
              <Chip on={who.has('relative')} count={counts.who.relative} onClick={() => setWho((s) => toggle(s, 'relative'))}>
                Relatives and others on the case
              </Chip>
            </FilterRow>
            <FilterRow label="Letter">
              <Chip on={stages.has('first')} count={counts.stage.first} onClick={() => setStages((s) => toggle(s, 'first'))}>
                First letter
              </Chip>
              <Chip on={stages.has('followup')} count={counts.stage.followup} onClick={() => setStages((s) => toggle(s, 'followup'))}>
                Follow-up letters
              </Chip>
              <span className="w-2" />
              <Chip on={mails.has('standard')} count={counts.mail.standard} onClick={() => setMails((s) => toggle(s, 'standard'))}>
                Standard mail
              </Chip>
              <Chip on={mails.has('priority')} count={counts.mail.priority} onClick={() => setMails((s) => toggle(s, 'priority'))}>
                Priority (3 unanswered)
              </Chip>
            </FilterRow>
            <FilterRow label="Narrow">
              <select value={county} onChange={(e) => setCounty(e.target.value)} className="h-8 rounded-lg border border-gray-300 text-[13px] px-2 bg-white" aria-label="County">
                <option value="">Every county</option>
                {countyOptions.map(([c, n]) => (
                  <option key={c} value={c}>
                    {c} ({n.toLocaleString()})
                  </option>
                ))}
                {county && !counts.county.has(county) && <option value={county}>{county} (0)</option>}
              </select>
              <select value={netFloor} onChange={(e) => setNetFloor(Number(e.target.value))} className="h-8 rounded-lg border border-gray-300 text-[13px] px-2 bg-white" aria-label="Net to claimant">
                {NET_FLOORS.map(([v, l]) => (
                  <option key={v} value={v}>
                    Net: {l}
                  </option>
                ))}
              </select>
              <label className="h-8 px-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 text-[13px] bg-white cursor-pointer">
                <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />
                Under two months to the cutoff
              </label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, case or address"
                className="h-8 w-52 rounded-lg border border-gray-300 text-[13px] px-2"
                aria-label="Search"
              />
              {filtered && (
                <button type="button" onClick={resetFilters} className="text-[13px] text-primary-700 hover:underline">
                  Clear filters
                </button>
              )}
            </FilterRow>
          </div>

          {/* The templates these letters use, one click from their text. */}
          {kindsInPlay.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-gray-500">{picked.length ? 'Your pick uses' : 'These letters use'}:</span>
              {kindsInPlay.map(([kind, { label, n }]) => (
                <a
                  key={kind}
                  href={templateHref(kind)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 h-7 text-gray-700 hover:border-primary-400 hover:text-primary-700"
                  title={`Edit the text of "${label}" in Settings (opens in a new tab)`}
                >
                  {label} <span className="text-gray-400 tabular-nums">{n}</span> <span aria-hidden>✎</span>
                </a>
              ))}
            </div>
          )}

          {/* The list. */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-gray-50 text-[13px]">
              <span className="font-medium text-gray-800">
                {shown.length.toLocaleString()} letter{shown.length === 1 ? '' : 's'} shown
              </span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-600">Pick the top</span>
              {[...TOP_PICKS.filter((n) => n < shown.length && n <= cap), ...(shown.length && shown.length <= cap ? [shown.length] : [])].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickTop(n)}
                  className="h-7 px-2.5 rounded-md border border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-100"
                >
                  {n === shown.length ? `All ${n}` : n}
                </button>
              ))}
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} className="text-primary-700 hover:underline">
                  Clear selection
                </button>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-gray-600">
                Order
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-7 rounded-md border border-gray-300 bg-white px-1.5">
                  <option value="board">Board order</option>
                  <option value="net">Biggest net first</option>
                  <option value="cutoff">Closest to the cutoff</option>
                  <option value="county">County and case</option>
                </select>
              </label>
            </div>

            {loading && !plan ? (
              <p className="p-6 text-sm text-gray-500">Loading the letters due...</p>
            ) : shown.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">
                {envelopes.length ? 'No letter due matches these filters.' : 'No letters are due. Every address on file has been written to inside its cadence.'}
                {filtered && envelopes.length > 0 && (
                  <button type="button" onClick={resetFilters} className="ml-2 text-primary-700 hover:underline">
                    Clear filters
                  </button>
                )}
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="w-10 px-4 py-2">
                      <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} aria-label="Pick every letter shown" title={shown.length > cap ? `Picks the first ${cap} shown` : 'Pick every letter shown'} />
                    </th>
                    <th className="py-2 pr-3">Goes to</th>
                    <th className="py-2 pr-3">Case</th>
                    <th className="py-2 pr-3">Letter</th>
                    <th className="py-2 pr-3 text-right">Net</th>
                    <th className="py-2 pr-4 text-right">Cutoff</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const k = key(e);
                    const on = selected.has(k);
                    const r = ratingOf(e);
                    return (
                      <tr key={k} onClick={() => toggleOne(e)} className={`border-b border-gray-100 cursor-pointer ${on ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-4 py-2 align-top" onClick={(ev) => ev.stopPropagation()}>
                          <input type="checkbox" checked={on} onChange={() => toggleOne(e)} aria-label={`Pick the letter to ${e.recipientName}`} />
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium text-gray-900">{e.recipientName}</div>
                          <div className="text-[12px] text-gray-500">
                            {e.heirId ? `${e.why.split(',')[0]} of ${e.claimant} · ` : ''}
                            {e.address}
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-block rounded px-1.5 text-[11px] font-semibold mr-1.5 ${
                              r === 'A' ? 'bg-green-100 text-green-800' : r === 'B' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {r === 'NONE' ? 'Not rated' : `${r} Tier`}
                          </span>
                          <span className="text-gray-700">{e.county}</span>
                          <div className="text-[12px] text-gray-500">
                            <a href={`/surplus-funds?lead=${e.leadId}`} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="hover:underline">
                              {e.caseNumber || 'Open the case'}
                            </a>
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div className="text-gray-800">
                            {e.letterNumber > 1 ? `Letter ${e.letterNumber}` : 'First letter'}
                            {e.mailType === 'priority' && <span className="ml-1.5 rounded bg-purple-100 text-purple-800 px-1.5 text-[11px] font-semibold">Priority</span>}
                          </div>
                          <div className="text-[12px] text-gray-500">{e.kindLabel}</div>
                        </td>
                        <td className="py-2 pr-3 align-top text-right tabular-nums text-gray-800">{money(e.netToClaimant)}</td>
                        <td className={`py-2 pr-4 align-top text-right tabular-nums ${e.shortWindow ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                          {e.daysToCutoff == null ? '' : `${e.daysToCutoff} days`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!showAll && shown.length > ROWS_SHOWN && (
              <button type="button" onClick={() => setShowAll(true)} className="w-full py-3 text-[13px] text-primary-700 hover:bg-gray-50 border-t border-gray-100">
                Show all {shown.length.toLocaleString()} ({(shown.length - ROWS_SHOWN).toLocaleString()} more)
              </button>
            )}
          </div>
        </div>

        {/* What is picked and the one way forward. */}
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
          <div className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
            <div className="text-sm">
              {picked.length ? (
                <>
                  <span className="font-semibold text-gray-900">{picked.length.toLocaleString()} picked</span>
                  <span className="text-gray-600">
                    {' '}
                    · {picked.filter((e) => !e.heirId).length} to claimants, {picked.filter((e) => !!e.heirId).length} to relatives · about ${pickedPostage.toFixed(2)} postage
                  </span>
                  {picked.length > pickedShown && <span className="text-gray-500"> ({picked.length - pickedShown} hidden by the filters)</span>}
                  {picked.length >= cap && <span className="text-amber-700"> · {cap} is the most one run holds</span>}
                </>
              ) : (
                <span className="text-gray-500">Tick the letters to send, or pick the top 25, 50, 100 or 200 shown.</span>
              )}
            </div>
            <button
              type="button"
              onClick={render}
              disabled={!picked.length || rendering}
              className="ml-auto h-10 px-5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50"
            >
              {rendering ? `Building ${picked.length} letters...` : `Review and print ${picked.length || ''} →`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: review and print ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; break-after: page; page-break-after: always; }
          .sheet:last-child { break-after: auto; page-break-after: auto; }
          @page { margin: 1in; }
        }
      `}</style>

      {/* The controls. Hidden on paper. */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <button type="button" onClick={() => setStep('choose')} disabled={busy} className="text-gray-500 hover:text-gray-700 disabled:opacity-50">
              ← Change who is in the run
            </button>
            <span className="font-semibold text-gray-900 ml-3">Print run</span>
            {run && (
              <span className="text-gray-500">
                {' '}
                · {run.letters.length} letter{run.letters.length === 1 ? '' : 's'} ({run.letters.filter((l) => !l.heirId).length} to claimants, {run.letters.filter((l) => !!l.heirId).length} to relatives)
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a href={templateHref('letter_claimant')} target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Edit letter templates ↗
            </a>
            {!result && (
              <button
                type="button"
                onClick={render}
                disabled={rendering || busy}
                title="Build these letters again, for example after editing a template"
                className="h-9 px-3 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {rendering ? 'Refreshing...' : 'Refresh text'}
              </button>
            )}
            {lob?.configured && !result && (
              <button
                type="button"
                onClick={sendLob}
                disabled={lobBusy || busy || rendering || !lobSendable.length || (lob.mode === 'live' && (lob.remaining ?? 0) === 0)}
                title={
                  lob.mode === 'live'
                    ? `Lob prints and mails these First Class and each is recorded as mailed. ${lob.remaining ?? 0} of ${lob.monthlyLimit ?? 0} left this month.`
                    : 'Test key: Lob makes a proof PDF of each letter and mails nothing'
                }
                className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 ${
                  lob.mode === 'live' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-amber-500 text-amber-800 bg-amber-50 hover:bg-amber-100'
                }`}
              >
                {lobBusy ? 'Sending to Lob...' : lob.mode === 'live' ? `Mail ${lobSendable.length} through Lob` : `Lob test proofs, ${lobSendable.length}`}
              </button>
            )}
            <button
              onClick={() => window.print()}
              disabled={!kept.length || rendering}
              className="h-9 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              Print {kept.length || ''}
            </button>
            {result ? (
              <span className="text-sm font-medium text-green-700">
                Recorded {result.mailed} as mailed, ${result.postageTotal.toFixed(2)} postage logged
                {result.failed.length ? `, ${result.failed.length} failed` : ''}.
              </span>
            ) : (
              <button
                onClick={mailed}
                disabled={busy || rendering || !kept.length}
                title="Write every letter on this page to its claim as mailed today and log the postage"
                className="h-9 px-4 rounded-lg border border-primary-600 text-primary-700 text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
              >
                {busy ? 'Recording...' : `Mailed, all ${kept.length}`}
              </button>
            )}
            {result && (
              <button onClick={nextRun} className="h-9 px-4 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                Build the next run
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Postage per envelope</span>
          {MAIL_TYPES.map(([t, l]) => (
            <label key={t} className="flex items-center gap-1">
              {l} $
              <input
                value={postage[t]}
                onChange={(e) => setPostage((p) => ({ ...p, [t]: e.target.value }))}
                className="h-7 w-16 rounded border border-gray-300 px-1 text-xs"
                inputMode="decimal"
                aria-label={`${l} postage`}
              />
            </label>
          ))}
          <span>
            {kept.length} to mail, ${estimate.total.toFixed(2)} postage{estimate.missing ? ` (${estimate.missing} with no price set, logged at $0)` : ''}
          </span>
          {unprintable.length > 0 && (
            <span className="text-amber-700">
              {unprintable.length} left out: no template text or a merge field could not be filled. Fix the file or the template, then Refresh text.
            </span>
          )}
          {notDueNames.length > 0 && (
            <span className="text-amber-700">
              {notDueNames.length} no longer due and left out ({notDueNames.slice(0, 5).join(', ')}
              {notDueNames.length > 5 ? ', ...' : ''}).
            </span>
          )}
          {lob?.configured && lob.mode === 'test' && !lobResult && (
            <span className="text-amber-700">Lob is on a test key: sending makes proof PDFs only, nothing is mailed or recorded.</span>
          )}
          {lob?.configured && lob.mode === 'live' && (
            <span>
              Lob: {lob.sentThisMonth} of {lob.monthlyLimit} sent this month
            </span>
          )}
          {lobResult && (
            <span className={lobResult.failed.length ? 'text-red-600' : 'text-green-700 font-medium'}>
              {lobResult.mode === 'test'
                ? `${lobResult.sent.length} test proof${lobResult.sent.length === 1 ? '' : 's'} made, nothing mailed. Open them from each letter below.`
                : `Lob is mailing ${lobResult.sent.length}, recorded with $${lobResult.postageTotal.toFixed(2)} postage.`}
              {lobResult.heldBack.length ? ` ${lobResult.heldBack.length} held back (reason on each letter).` : ''}
              {lobResult.failed.length ? ` ${lobResult.failed.length} failed (reason on each letter).` : ''}
            </span>
          )}
          {result?.failed.length ? (
            <span className="text-red-600">Failed: {result.failed.map((f) => `${f.recipientName || 'a letter'} (${f.error})`).join('; ')}</span>
          ) : null}
        </div>
      </div>

      {error && <p className="no-print p-8 text-sm text-red-600">{error}</p>}
      {run && run.letters.length === 0 && !error && (
        <p className="no-print p-8 text-sm text-gray-500">None of the letters picked is still due. Go back and pick again.</p>
      )}

      {run?.letters.map((l, i) => {
        const k = key(l);
        const viaLob = lobByKey.get(k);
        const off = dropped.has(k) || lobSent.has(k) || !l.hasText || l.unfilled.length > 0;
        const type = mailTypes[k] || l.mailType;
        return (
          <div key={k} className={off ? 'no-print' : undefined}>
            {/* The strip above each letter: who, which letter, how it goes. Hidden on paper. */}
            <div className={`no-print mx-auto w-[8.5in] mt-8 px-3 py-2 rounded-t-lg text-xs flex flex-wrap items-center gap-3 ${off ? 'bg-gray-200 text-gray-500' : 'bg-gray-800 text-gray-100'}`}>
              <span className="font-semibold">
                {i + 1} of {run.letters.length}
              </span>
              <span>
                {l.recipientName}
                {l.heirId ? ` (for ${l.claimant})` : ''} · {[l.county ? `${l.county} County` : null, l.caseNumber].filter(Boolean).join(' ')}
              </span>
              <span className="opacity-80">
                {l.why} · {l.label} {l.versionLabel}
              </span>
              <a href={templateHref(l.kind, l.templateCounty)} target="_blank" rel="noreferrer" className="underline opacity-90 hover:opacity-100">
                Edit this text ↗
              </a>
              {!l.hasText && <span className="text-amber-300">No template text for this kind yet. Write it with Edit this text.</span>}
              {l.unfilled.length > 0 && <span className="text-amber-300">Could not fill: {l.unfilled.join(', ')}</span>}
              {viaLob?.sent && lobResult?.mode === 'test' && viaLob.sent.url && (
                <a href={viaLob.sent.url} target="_blank" rel="noreferrer" className="underline text-amber-300">
                  Lob test proof ↗
                </a>
              )}
              {viaLob?.sent && lobResult?.mode === 'live' && (
                <span className="text-emerald-300">
                  Lob is mailing it{viaLob.sent.expectedDeliveryDate ? `, expected ${viaLob.sent.expectedDeliveryDate}` : ''}
                </span>
              )}
              {viaLob?.held && <span className="text-amber-300">Not sent to Lob: {viaLob.held}</span>}
              {viaLob?.failed && <span className="text-red-300">Lob: {viaLob.failed}</span>}
              <span className="ml-auto flex items-center gap-2">
                <select
                  value={type}
                  onChange={(e) => setMailTypes((m) => ({ ...m, [k]: e.target.value as MailType }))}
                  className="h-7 rounded border border-gray-500 bg-gray-900 text-gray-100 text-xs px-1"
                  aria-label="Mail type"
                  disabled={off}
                >
                  {MAIL_TYPES.map(([t, lab]) => (
                    <option key={t} value={t}>
                      {lab}
                    </option>
                  ))}
                </select>
                {type !== 'standard' && (
                  <input
                    value={tracking[k] || ''}
                    onChange={(e) => setTracking((t) => ({ ...t, [k]: e.target.value }))}
                    placeholder="Tracking number"
                    className="h-7 w-36 rounded border border-gray-500 bg-gray-900 text-gray-100 text-xs px-1"
                    disabled={off}
                  />
                )}
                {l.hasText && l.unfilled.length === 0 && (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={dropped.has(k)} onChange={() => toggleDrop(l)} />
                    Leave out
                  </label>
                )}
              </span>
            </div>

            {/* The letter itself, US Letter proportions on screen. */}
            <div className={`sheet mx-auto bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12.5pt] leading-[1.5] text-gray-900 font-serif ${off ? 'opacity-50' : ''}`}>
              <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-8">
                <div>
                  <div className="text-[16pt] font-semibold tracking-tight">{l.sender.companyName}</div>
                  <div className="text-[10pt] text-gray-600">
                    {l.sender.phone}
                    {l.sender.website ? ` · ${l.sender.website}` : ''}
                  </div>
                </div>
                <div className="text-[10pt] text-gray-600">Re: {l.propertyAddress}</div>
              </div>
              <pre className="whitespace-pre-wrap font-serif text-[12.5pt] leading-[1.5]">{l.body}</pre>
            </div>
          </div>
        );
      })}
      <div className="h-8" />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Loading the letters due...</p>}>
      <PrintRunPage />
    </Suspense>
  );
}
