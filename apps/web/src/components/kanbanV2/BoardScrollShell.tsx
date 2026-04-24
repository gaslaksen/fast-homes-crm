'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type WheelEvent,
} from 'react';

interface Props {
  children: ReactNode;
  offsetTopEl?: HTMLElement | null;
}

export default function BoardScrollShell({ children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const topBarInnerRef = useRef<HTMLDivElement>(null);

  // Compute available height from our top offset to viewport bottom.
  useLayoutEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = Math.max(window.innerHeight - top - 8, 320);
      el.style.height = `${h}px`;
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Sync mirrored top scrollbar with main content scroll
  useEffect(() => {
    const main = scrollRef.current;
    const top = topBarRef.current;
    const inner = topBarInnerRef.current;
    if (!main || !top || !inner) return;

    const syncInnerWidth = () => {
      inner.style.width = `${main.scrollWidth}px`;
    };
    syncInnerWidth();

    const onMain = () => {
      top.scrollLeft = main.scrollLeft;
    };
    const onTop = () => {
      main.scrollLeft = top.scrollLeft;
    };
    main.addEventListener('scroll', onMain, { passive: true });
    top.addEventListener('scroll', onTop, { passive: true });

    const ro = new ResizeObserver(syncInnerWidth);
    ro.observe(main);
    Array.from(main.children).forEach((c) => ro.observe(c as Element));

    return () => {
      main.removeEventListener('scroll', onMain);
      top.removeEventListener('scroll', onTop);
      ro.disconnect();
    };
  }, []);

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.shiftKey && scrollRef.current && e.deltaY !== 0) {
      scrollRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const main = scrollRef.current;
    if (!main) return;
    if (e.key === 'ArrowRight') {
      main.scrollLeft += 280;
    } else if (e.key === 'ArrowLeft') {
      main.scrollLeft -= 280;
    }
  };

  return (
    <div ref={containerRef} className="flex flex-col w-full">
      {/* Mirrored top scrollbar */}
      <div
        ref={topBarRef}
        className="shrink-0 overflow-x-auto overflow-y-hidden h-3 border-b border-gray-200 dark:border-gray-800"
      >
        <div ref={topBarInnerRef} className="h-3" />
      </div>
      {/* Main horizontal scroll region */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-x-auto overflow-y-hidden focus:outline-none"
        style={{ scrollSnapType: 'x proximity' }}
      >
        <div className="flex h-full">{children}</div>
      </div>
    </div>
  );
}
