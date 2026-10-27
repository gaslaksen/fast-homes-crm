'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Company, MODULE_HREF, moduleForPath, selectCompany, useCompanies } from '@/lib/companies';

function initials(c: Company): string {
  // "D.I.G. Deeper" reads as DD, not DI.
  const words = c.name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || c.key.slice(0, 2).toUpperCase();
}

/**
 * Picks which company's pipelines the menu shows. Hidden for a login with
 * only one company. Switching while on another company's pipeline moves to
 * the new company's first pipeline, so the page and the menu agree.
 *
 * The collapsed sidebar is too narrow for a menu (and clips overflow), so
 * there a click moves straight to the next company.
 */
export default function CompanySwitcher({
  variant,
  collapsed = false,
}: {
  variant: 'sidebar' | 'topbar';
  collapsed?: boolean;
}) {
  const { companies, current, canSwitch } = useCompanies();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!canSwitch || !current) return null;

  const choose = (c: Company) => {
    setOpen(false);
    if (c.key === current.key) return;
    selectCompany(c.key);
    const onModule = moduleForPath(pathname);
    if (onModule && !c.modules.includes(onModule) && c.modules[0]) {
      router.push(MODULE_HREF[c.modules[0]]);
    }
  };

  const dark = variant === 'sidebar';
  const button = dark
    ? `w-full flex items-center rounded-md border border-gray-700 bg-gray-800/60 text-gray-100 hover:bg-gray-800 transition-colors ${
        collapsed ? 'justify-center h-10' : 'gap-2 px-3 py-2'
      }`
    : // Capped in the top bar, whose links already run long on a narrow window.
      'flex items-center gap-2 md:max-w-[11rem] rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors';
  const menu = dark
    ? 'bg-gray-800 border-gray-700 text-gray-100'
    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!collapsed) return setOpen((o) => !o);
          const i = companies.findIndex((c) => c.key === current.key);
          choose(companies[(i + 1) % companies.length]);
        }}
        className={button}
        aria-haspopup={collapsed ? undefined : 'listbox'}
        aria-expanded={collapsed ? undefined : open}
        aria-label={`Company: ${current.name}. Switch company`}
        title={collapsed ? `${current.name} (click to switch)` : undefined}
      >
        {collapsed ? (
          <span className="text-xs font-semibold">{initials(current)}</span>
        ) : (
          <>
            <span className={`flex-1 min-w-0 truncate text-left font-medium ${dark ? 'text-[13px]' : 'text-sm'}`}>
              {current.name}
            </span>
            <svg className="w-4 h-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
            </svg>
          </>
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Companies"
          className={`absolute z-50 mt-1 left-0 ${dark ? 'right-0' : 'min-w-[14rem]'} rounded-md border shadow-lg py-1 ${menu}`}
        >
          {companies.map((c) => (
            <li key={c.key} role="option" aria-selected={c.key === current.key}>
              <button
                type="button"
                onClick={() => choose(c)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 ${
                  c.key === current.key ? 'font-semibold' : ''
                }`}
              >
                <span className="flex-1 truncate">{c.name}</span>
                {c.key === current.key && (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
