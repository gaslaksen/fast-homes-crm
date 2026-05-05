'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import PropertyPhoto from '@/components/PropertyPhoto';
import { getStage } from '@/lib/pipelineStages';
import { getLeadAddressLine, getLeadDisplayName } from '@/lib/format';
import { zillowUrl, realtorUrl } from '@/lib/externalLinks';

interface Props {
  lead: any;
  onMarkDead: () => void;
  onRefreshFromReapi: () => Promise<{ success: boolean; message?: string } | void> | void;
}

const TIER_PILL: Record<number, string> = {
  1: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-300 dark:border-green-800',
  2: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800',
  3: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600',
};

export default function LeadDetailHeader({ lead, onMarkDead, onRefreshFromReapi }: Props) {
  const displayName = getLeadDisplayName(lead);
  const addressLine = getLeadAddressLine(lead);
  const stage = getStage(lead.status);
  const isDead = lead.status === 'DEAD';
  const noPhone = !lead.sellerPhone;
  const dnc = !!lead.doNotContact;
  const callDisabled = noPhone || dnc || isDead;
  const textDisabled = noPhone || dnc || isDead;

  // Smrtphone Chrome extension hijacks tel: links and rewrites the inner
  // text to "| Send Text" (adding class .smrtphoneText + data-extension).
  // When detected, hide our redundant Text button and strip the leading pipe.
  const actionClusterRef = useRef<HTMLDivElement>(null);
  const [smsExtensionDetected, setSmsExtensionDetected] = useState(false);
  useEffect(() => {
    const node = actionClusterRef.current;
    if (!node) return;
    let observer: MutationObserver | null = null;
    const checkAndClean = () => {
      if (!node) return;
      const text = node.textContent || '';
      const hasSendText = text.includes('Send Text');
      setSmsExtensionDetected(hasSendText);
      if (!hasSendText) return;

      observer?.disconnect();

      // Strip the "| " prefix the extension adds inside .smrtphoneText elements.
      const injected = node.querySelectorAll<HTMLElement>(
        '.smrtphoneText, [data-extension="smrtPhone"]',
      );
      injected.forEach((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const tn = walker.currentNode as Text;
          const original = tn.textContent || '';
          const cleaned = original.replace(/^\s*[│|]\s*/, '');
          if (cleaned !== original) tn.textContent = cleaned;
        }
      });

      // Fallback: any standalone pipe text node in the cluster.
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const toClear: Text[] = [];
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text;
        if (/^\s*[│|]\s*$/.test(tn.textContent || '')) toClear.push(tn);
      }
      toClear.forEach((t) => {
        t.textContent = '';
      });

      observer?.observe(node, { childList: true, subtree: true, characterData: true });
    };
    const t1 = setTimeout(checkAndClean, 100);
    const t2 = setTimeout(checkAndClean, 600);
    observer = new MutationObserver(checkAndClean);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      observer.disconnect();
    };
  }, [lead.sellerPhone, lead.id]);

  const callTooltip = noPhone
    ? 'No phone number on file'
    : dnc
      ? 'Marked Do Not Contact'
      : isDead
        ? 'Lead is marked Dead'
        : 'Call seller';
  const textTooltip = noPhone
    ? 'No phone number on file'
    : dnc
      ? 'Marked Do Not Contact'
      : isDead
        ? 'Lead is marked Dead'
        : 'Open Communications';

  const lastTouched =
    lead.lastTouchedAt
      ? formatDistanceToNow(new Date(lead.lastTouchedAt), { addSuffix: true })
      : null;

  const addressParts = {
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
  };
  const zillowHref = zillowUrl(addressParts);
  const realtorHref = realtorUrl(addressParts);

  const actionCluster = (
    <div
      ref={actionClusterRef}
      className="lead-header-actions flex items-center gap-2 flex-shrink-0 w-full sm:w-auto"
    >
      <ActionButton
        kind="call"
        disabled={callDisabled}
        tooltip={callTooltip}
        href={callDisabled ? undefined : `tel:${lead.sellerPhone}`}
        fullWidthOnMobile
      />
      {!smsExtensionDetected && (
        <ActionButton
          kind="text"
          disabled={textDisabled}
          tooltip={textTooltip}
          href={textDisabled ? undefined : `/leads/${lead.id}?tab=communications`}
          isInternal
          fullWidthOnMobile
        />
      )}
      <OverflowMenu
        leadId={lead.id}
        zillowUrl={zillowHref}
        realtorUrl={realtorHref}
        onMarkDead={onMarkDead}
        onRefreshFromReapi={onRefreshFromReapi}
      />
    </div>
  );

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
          <PropertyPhoto
            src={lead.primaryPhoto}
            scoreBand={lead.scoreBand}
            address={lead.propertyAddress}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <Link href="/leads" className="hover:text-gray-700 dark:hover:text-gray-100 transition-colors">
                Leads
              </Link>
              <span>/</span>
              <span className="text-gray-600 dark:text-gray-400 font-medium truncate">{displayName}</span>
            </div>
            <h1 className="text-base sm:text-[22px] font-semibold sm:font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">
              {displayName}
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">{addressLine}</p>
            <StatusLine
              isDead={isDead}
              tier={lead.tier}
              stageName={stage?.name}
              stageColor={stage?.color}
              touchCount={lead.touchCount ?? 0}
              lastTouched={lastTouched}
            />
          </div>
          <div className="hidden sm:block">{actionCluster}</div>
        </div>
        <div className="mt-3 sm:hidden">{actionCluster}</div>
      </div>
    </header>
  );
}

function StatusLine({
  isDead,
  tier,
  stageName,
  stageColor,
  touchCount,
  lastTouched,
}: {
  isDead: boolean;
  tier?: number | null;
  stageName?: string;
  stageColor?: string;
  touchCount: number;
  lastTouched: string | null;
}) {
  if (isDead) {
    return (
      <div className="mt-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[11px] font-semibold border border-red-300 dark:border-red-800">
          💀 DEAD
        </span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
      {tier ? (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-[11px] font-semibold ${TIER_PILL[tier] || TIER_PILL[3]}`}>
          T{tier}
        </span>
      ) : null}
      {stageName ? (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium ${stageColor || 'bg-gray-100 text-gray-600'}`}>
          {stageName}
        </span>
      ) : null}
      <span>{touchCount} {touchCount === 1 ? 'touch' : 'touches'}</span>
      {lastTouched ? <span>Last touched {lastTouched}</span> : null}
    </div>
  );
}

function ActionButton({
  kind,
  disabled,
  tooltip,
  href,
  isInternal,
  fullWidthOnMobile,
}: {
  kind: 'call' | 'text';
  disabled: boolean;
  tooltip: string;
  href?: string;
  isInternal?: boolean;
  fullWidthOnMobile?: boolean;
}) {
  const label = kind === 'call' ? 'Call' : 'Text';
  const icon =
    kind === 'call' ? (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ) : (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    );

  const baseClasses =
    kind === 'call'
      ? 'bg-primary-600 hover:bg-primary-700 text-white border border-primary-600'
      : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600';
  const widthClass = fullWidthOnMobile ? 'flex-1 justify-center sm:flex-initial' : '';
  const className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${widthClass} ${baseClasses}`;

  if (disabled || !href) {
    return (
      <button type="button" disabled title={tooltip} className={className}>
        {icon}
        {label}
      </button>
    );
  }

  if (isInternal) {
    return (
      <Link href={href} title={tooltip} className={className}>
        {icon}
        {label}
      </Link>
    );
  }

  return (
    <a href={href} title={tooltip} className={className}>
      {icon}
      {label}
    </a>
  );
}

function OverflowMenu({
  leadId,
  zillowUrl,
  realtorUrl,
  onMarkDead,
  onRefreshFromReapi,
}: {
  leadId: string;
  zillowUrl: string;
  realtorUrl: string;
  onMarkDead: () => void;
  onRefreshFromReapi: Props['onRefreshFromReapi'];
}) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await onRefreshFromReapi();
      if (result && 'success' in result && !result.success) {
        alert(result.message || 'Property details not found');
      }
    } catch (err: any) {
      alert(`Refresh failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setRefreshing(false);
      setOpen(false);
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/leads/${leadId}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          setOpen(false);
        }, 1200);
      },
      () => {
        alert('Could not copy link');
      },
    );
  }

  function handleMarkDead() {
    setOpen(false);
    if (window.confirm('Mark this lead as dead? You can reopen it later from the Disposition tab.')) {
      onMarkDead();
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        title="More actions"
        className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-30">
          <a
            href={zillowUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            Open in Zillow
          </a>
          <a
            href={realtorUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            Open in Realtor.com
          </a>
          <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh from REAPI'}
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            {copied ? 'Copied!' : 'Copy lead link'}
          </button>
          <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
          <button
            type="button"
            onClick={handleMarkDead}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-red-600 dark:text-red-400"
          >
            Mark Dead
          </button>
        </div>
      )}
    </div>
  );
}
