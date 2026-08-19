'use client';

import { Fragment, ReactNode, useCallback, useEffect, useRef, useState } from 'react';

/**
 * The horizontal card rack shared by the Tax Sales and Surplus Funds boards,
 * plus the grid view it toggles into and the scroll controls for both.
 *
 * Movement runs on a transform, not scrollLeft. scrollLeft makes the browser
 * re-run scrolling and painting every frame and snaps to whole pixels, which is
 * what reads as steppy; translate3d hands the work to the compositor and takes
 * fractional pixels, so easing lands between pixels instead of stair-stepping.
 * One rAF loop owns all motion and shuts itself off when nothing is moving
 * rather than spinning forever.
 */

const MIN_THUMB = 0.09;
const EASE = 0.18; // portion of the remaining gap closed per frame
const FRICTION = 0.955; // per-frame velocity decay
const RUBBER = 0.35; // resistance past either end
const CARD_STEP = 358; // one card plus the belt gap
const ROW_STEP = 616; // one grid row, so the arrows step exactly one lead

export type RackView = 'rack' | 'grid';

interface Props<T> {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  view: RackView;
  onViewChange: (v: RackView) => void;
  /** Left of the toolbar: the "N leads / M selected" readout. */
  toolbarLeft?: ReactNode;
  /** Right of the toolbar, after the view toggle: select-all, CSV, and so on. */
  toolbarRight?: ReactNode;
  /** Shown in place of the belt when there is nothing to show. */
  empty?: ReactNode;
}

export default function LeadRack<T>({
  items,
  keyOf,
  renderItem,
  view,
  onViewChange,
  toolbarLeft,
  toolbarRight,
  empty,
}: Props<T>) {
  const [grabbing, setGrabbing] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [track, setTrack] = useState({ pct: 0, ratio: 1 });
  const [vtrack, setVtrack] = useState({ pct: 0, ratio: 1 });
  const [vseek, setVseek] = useState(false);

  const viewRef = useRef<HTMLDivElement>(null); // the clipping window
  const beltRef = useRef<HTMLDivElement>(null); // the thing that actually moves
  const sliderRef = useRef<HTMLDivElement>(null);
  const slideWrapRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLElement>(null);
  const vRailRef = useRef<HTMLDivElement>(null);
  const vColRef = useRef<HTMLDivElement>(null);
  const vThumbRef = useRef<HTMLElement>(null);

  const pos = useRef(0); // current offset, may overshoot while rubber banding
  const goal = useRef<number | null>(null); // eased destination, null when coasting
  const vel = useRef(0); // px per 60fps frame
  const loop = useRef(0);
  const last = useRef(0);
  const samples = useRef<{ x: number; t: number }[]>([]);
  const drag = useRef({ on: false, x0: 0, p0: 0, moved: false });
  const swallow = useRef(false);
  const geom = useRef({ pct: 0, ratio: 1 });
  const syncing = useRef(false);
  const vSync = useRef(false);
  const viewMode = useRef<RackView>(view);
  viewMode.current = view;

  const reduced =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const maxX = useCallback(() => {
    const v = viewRef.current;
    const b = beltRef.current;
    if (!v || !b) return 0;
    return Math.max(0, b.scrollWidth - v.clientWidth);
  }, []);

  const clamp = useCallback((x: number) => Math.max(0, Math.min(maxX(), x)), [maxX]);

  const paint = useCallback(() => {
    if (viewMode.current !== 'rack') return;
    const v = viewRef.current;
    const b = beltRef.current;
    if (!v || !b) return;
    b.style.transform = `translate3d(${-pos.current}px,0,0)`;

    const m = maxX();
    const pct = m > 0 ? Math.min(1, Math.max(0, pos.current / m)) : 0;
    const ratio = b.scrollWidth ? Math.min(1, v.clientWidth / b.scrollWidth) : 1;
    geom.current = { pct, ratio };

    const t = thumbRef.current;
    if (t) {
      const w = Math.max(MIN_THUMB, ratio) * 100;
      t.style.width = `${w}%`;
      t.style.left = `${pct * (100 - w)}%`;
    }

    // React only needs to know for the readout, the fades and the arrow states.
    if (syncing.current) return;
    syncing.current = true;
    requestAnimationFrame(() => {
      syncing.current = false;
      setTrack((prev) =>
        Math.abs(prev.pct - geom.current.pct) > 0.005 ||
        Math.abs(prev.ratio - geom.current.ratio) > 0.005
          ? { ...geom.current }
          : prev,
      );
    });
  }, [maxX]);

  const tick = useCallback(
    (now: number) => {
      const dt = last.current ? Math.min(64, now - last.current) : 16.67;
      last.current = now;
      const f = dt / 16.67;
      let moving = false;

      if (goal.current !== null) {
        const diff = goal.current - pos.current;
        if (Math.abs(diff) < 0.3) {
          pos.current = goal.current;
          goal.current = null;
        } else {
          pos.current += diff * (1 - Math.pow(1 - EASE, f));
          moving = true;
        }
      } else if (Math.abs(vel.current) > 0.12) {
        pos.current += vel.current * f;
        vel.current *= Math.pow(FRICTION, f);
        moving = true;
        const m = maxX();
        if (pos.current < 0) {
          pos.current = 0;
          vel.current = 0;
        } else if (pos.current > m) {
          pos.current = m;
          vel.current = 0;
        }
      }

      paint();
      loop.current = moving ? requestAnimationFrame(tick) : 0;
      if (!moving) last.current = 0;
    },
    [maxX, paint],
  );

  const run = useCallback(() => {
    if (!loop.current) {
      last.current = 0;
      loop.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const stopMotion = useCallback(() => {
    cancelAnimationFrame(loop.current);
    loop.current = 0;
    last.current = 0;
    goal.current = null;
    vel.current = 0;
  }, []);

  const glideTo = useCallback(
    (x: number) => {
      if (reduced) {
        pos.current = clamp(x);
        paint();
        return;
      }
      goal.current = clamp(x);
      vel.current = 0;
      run();
    },
    [clamp, paint, reduced, run],
  );

  // ── Dragging the cards ───────────────────────────────────────────────────

  const onDown = (e: React.PointerEvent) => {
    if (view !== 'rack') return;
    if ((e.target as HTMLElement).closest('input,textarea,select,button,a,label')) return;
    stopMotion();
    drag.current = { on: true, x0: e.clientX, p0: pos.current, moved: false };
    samples.current = [{ x: e.clientX, t: performance.now() }];
    setGrabbing(true);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.on) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 4) d.moved = true;
    let p = d.p0 - dx;
    const m = maxX();
    // Pull past the end and it resists, so the edge feels like a wall.
    if (p < 0) p *= RUBBER;
    else if (p > m) p = m + (p - m) * RUBBER;
    pos.current = p;
    paint();
    const s = samples.current;
    s.push({ x: e.clientX, t: performance.now() });
    if (s.length > 6) s.shift();
  };

  const onUp = () => {
    const d = drag.current;
    if (!d.on) return;
    d.on = false;
    setGrabbing(false);
    if (d.moved) {
      swallow.current = true;
      setTimeout(() => {
        swallow.current = false;
      }, 0);
    }

    const m = maxX();
    if (pos.current < 0 || pos.current > m) {
      glideTo(pos.current < 0 ? 0 : m);
      return;
    }

    // Velocity from the oldest surviving sample to the newest, not the last
    // two: one jittery mouse frame would otherwise throw the rack sideways.
    const s = samples.current;
    if (s.length >= 2 && !reduced) {
      const a = s[0];
      const b = s[s.length - 1];
      const dt = Math.max(1, b.t - a.t);
      const v = -((b.x - a.x) / dt) * 16;
      if (Math.abs(v) > 0.5) {
        vel.current = v;
        goal.current = null;
        run();
      }
    }
  };

  // ── Wheel ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = viewRef.current;
    if (!el || view !== 'rack') return;
    // A plain vertical wheel belongs to the page. Mapping it onto horizontal
    // movement meant the rack grabbed the page scroll every time the cursor
    // passed over it, which is worse than the problem it solved. Only a
    // deliberately horizontal gesture moves it: a sideways trackpad swipe, or
    // shift plus wheel.
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontal && !e.shiftKey) return;
      const raw = horizontal ? e.deltaX : e.deltaY;
      if (!raw) return;
      const m = maxX();
      if (m <= 0) return;
      const at = goal.current === null ? pos.current : goal.current;
      // Inverted to match the bar and the drag: a swipe right moves the cards
      // right, so moving toward the start happens on a positive delta.
      if ((raw > 0 && at <= 0) || (raw < 0 && at >= m - 1)) return;
      e.preventDefault();
      glideTo(at - raw);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, glideTo, maxX]);

  // Keep the belt in bounds when the window or the filtered list changes.
  useEffect(() => {
    const fix = () => {
      pos.current = clamp(pos.current);
      paint();
    };
    const id = requestAnimationFrame(fix);
    window.addEventListener('resize', fix);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', fix);
    };
  });

  useEffect(() => () => stopMotion(), [stopMotion]);

  /* The belt is moved with an inline transform and paint() bails out when the
     view is not "rack", so switching to grid used to leave the last horizontal
     offset stuck on the element and the grid rendered shifted sideways. Clear
     it on the way out and let paint() put it back on the way in. */
  useEffect(() => {
    stopMotion();
    const b = beltRef.current;
    if (!b) return;
    if (view === 'rack') {
      paint();
    } else {
      b.style.transform = '';
      pos.current = 0;
      const el = viewRef.current;
      if (el) el.scrollTop = 0;
    }
  }, [view, paint, stopMotion]);

  // ── The horizontal bar ───────────────────────────────────────────────────

  const sliderDown = (e: React.PointerEvent) => {
    const t = sliderRef.current;
    if (!t) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    const thumbW = Math.max(MIN_THUMB, geom.current.ratio) * r.width;
    const thumbLeft = geom.current.pct * (r.width - thumbW);
    const x = e.clientX - r.left;

    if (x < thumbLeft || x > thumbLeft + thumbW) {
      const v = viewRef.current;
      glideTo(pos.current + (x < thumbLeft ? -1 : 1) * (v ? v.clientWidth * 0.9 : CARD_STEP));
      return;
    }

    const grab = x - thumbLeft;
    stopMotion();
    setSeeking(true);
    const mv = (ev: PointerEvent) => {
      const rr = t.getBoundingClientRect();
      const w = Math.max(MIN_THUMB, geom.current.ratio) * rr.width;
      const usable = Math.max(1, rr.width - w);
      let p = (ev.clientX - rr.left - grab) / usable;
      p = Math.max(0, Math.min(1, p));
      pos.current = p * maxX();
      paint();
    };
    const up = () => {
      setSeeking(false);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  /* The bar is a scroll control, so any wheel over it drives the rack and never
     reaches the page. The delta is inverted on purpose: adding it raw made a
     swipe right push the cards left, which is backwards from dragging either
     the cards or the handle. */
  useEffect(() => {
    const wrap = slideWrapRef.current;
    if (!wrap || view !== 'rack') return;
    const onWheel = (e: WheelEvent) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!raw) return;
      e.preventDefault();
      if (maxX() <= 0) return;
      const at = goal.current === null ? pos.current : goal.current;
      glideTo(at - raw);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [view, glideTo, maxX]);

  const sliderKey = (e: React.KeyboardEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const map: Record<string, number> = {
      ArrowLeft: -CARD_STEP,
      ArrowRight: CARD_STEP,
      PageUp: -v.clientWidth,
      PageDown: v.clientWidth,
    };
    if (e.key === 'Home') {
      e.preventDefault();
      glideTo(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      glideTo(maxX());
      return;
    }
    if (map[e.key] === undefined) return;
    e.preventDefault();
    glideTo(pos.current + map[e.key]);
  };

  const nudge = (dir: number) => glideTo(pos.current + dir * CARD_STEP);

  // ── The vertical rail, grid view ─────────────────────────────────────────

  const vMeasure = useCallback(() => {
    if (viewMode.current !== 'grid') return;
    const el = viewRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? el.scrollTop / max : 0;
    const ratio = el.scrollHeight ? Math.min(1, el.clientHeight / el.scrollHeight) : 1;
    const t = vThumbRef.current;
    if (t) {
      const h = Math.max(MIN_THUMB, ratio) * 100;
      t.style.height = `${h}%`;
      t.style.top = `${pct * (100 - h)}%`;
    }
    if (vSync.current) return;
    vSync.current = true;
    requestAnimationFrame(() => {
      vSync.current = false;
      setVtrack((prev) =>
        Math.abs(prev.pct - pct) > 0.005 || Math.abs(prev.ratio - ratio) > 0.005
          ? { pct, ratio }
          : prev,
      );
    });
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(vMeasure);
    return () => cancelAnimationFrame(id);
  });

  const vNudge = (dir: number) => {
    const el = viewRef.current;
    if (el) el.scrollBy({ top: dir * ROW_STEP, behavior: 'smooth' });
  };

  const vDown = (e: React.PointerEvent) => {
    const rail = vRailRef.current;
    const el = viewRef.current;
    if (!rail || !el) return;
    e.preventDefault();
    const r = rail.getBoundingClientRect();
    const th = Math.max(MIN_THUMB, vtrack.ratio) * r.height;
    const top = vtrack.pct * (r.height - th);
    const y = e.clientY - r.top;
    if (y < top || y > top + th) {
      el.scrollBy({ top: (y < top ? -1 : 1) * el.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    const grab = y - top;
    setVseek(true);
    const mv = (ev: PointerEvent) => {
      const rr = rail.getBoundingClientRect();
      const h = Math.max(MIN_THUMB, vtrack.ratio) * rr.height;
      const usable = Math.max(1, rr.height - h);
      let pct = (ev.clientY - rr.top - grab) / usable;
      pct = Math.max(0, Math.min(1, pct));
      el.scrollTop = pct * (el.scrollHeight - el.clientHeight);
    };
    const up = () => {
      setVseek(false);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const vKey = (e: React.KeyboardEvent) => {
    const el = viewRef.current;
    if (!el) return;
    const map: Record<string, number> = {
      ArrowUp: -ROW_STEP,
      ArrowDown: ROW_STEP,
      PageUp: -el.clientHeight,
      PageDown: el.clientHeight,
    };
    if (e.key === 'Home') {
      e.preventDefault();
      el.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      return;
    }
    if (map[e.key] === undefined) return;
    e.preventDefault();
    el.scrollBy({ top: map[e.key], behavior: 'smooth' });
  };

  /* The rail sits outside the scrolling grid, so a wheel over it has nothing
     local to scroll and would move the page. It is swallowed for the whole
     length of the rail, including at both ends: reaching the top of the list
     should stop, not start dragging the page up behind it. */
  useEffect(() => {
    const col = vColRef.current;
    const el = viewRef.current;
    if (!col || !el || view !== 'grid') return;
    const onWheel = (e: WheelEvent) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!raw) return;
      e.preventDefault();
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      el.scrollTop = Math.max(0, Math.min(max, el.scrollTop - raw));
    };
    col.addEventListener('wheel', onWheel, { passive: false });
    return () => col.removeEventListener('wheel', onWheel);
  }, [view]);

  // ── Render ───────────────────────────────────────────────────────────────

  const barVisible = view === 'rack' && track.ratio < 1;
  const thumbW = Math.max(MIN_THUMB, track.ratio) * 100;
  const thumbLeft = track.pct * (100 - thumbW);
  // Which slice of the list is on screen, so the number means something.
  const per = Math.max(1, Math.round(items.length * track.ratio));
  const first = Math.max(0, Math.round(track.pct * (items.length - per))) + 1;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {toolbarLeft}

        <div
          className="dc-slidewrap"
          ref={slideWrapRef}
          aria-hidden={!barVisible}
          style={{ visibility: barVisible ? 'visible' : 'hidden' }}
        >
          <div
            className={`dc-slider${seeking ? ' on' : ''}`}
            ref={sliderRef}
            onPointerDown={sliderDown}
            onKeyDown={sliderKey}
            role="slider"
            tabIndex={0}
            aria-label="Scroll the lead rack"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(track.pct * 100)}
            aria-valuetext={`Showing leads ${first} to ${Math.min(items.length, first + per - 1)} of ${items.length}`}
            title="Drag the handle, click the track to page, or use the arrow keys"
          >
            <i ref={thumbRef} style={{ left: `${thumbLeft}%`, width: `${thumbW}%` }} />
          </div>
          <span className="dc-slidecount">
            {first}-{Math.min(items.length, first + per - 1)} of {items.length}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{ display: 'flex', gap: 6, visibility: view === 'rack' ? 'visible' : 'hidden' }}
            aria-hidden={view !== 'rack'}
          >
            <button className="dc-nudge" onClick={() => nudge(-1)} disabled={track.pct <= 0.001} title="Scroll left" aria-label="Scroll left">
              ‹
            </button>
            <button className="dc-nudge" onClick={() => nudge(1)} disabled={track.pct >= 0.999} title="Scroll right" aria-label="Scroll right">
              ›
            </button>
          </span>
          <div className="dc-seg">
            <button className={view === 'rack' ? 'on' : ''} onClick={() => onViewChange('rack')}>
              Rack
            </button>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => onViewChange('grid')}>
              Grid
            </button>
          </div>
          {toolbarRight}
        </div>
      </div>

      {items.length === 0 && empty}

      {items.length > 0 && (
        <div className={view === 'rack' ? 'dc-rackwrap' : 'dc-gridwrap'}>
          {view === 'grid' && (
            <div className="dc-vrail" ref={vColRef}>
              <button className="dc-nudge" onClick={() => vNudge(-1)} disabled={vtrack.pct <= 0.001} title="Up one lead" aria-label="Up one lead">
                ▲
              </button>
              <div
                className={`dc-vtrack${vseek ? ' on' : ''}`}
                ref={vRailRef}
                onPointerDown={vDown}
                onKeyDown={vKey}
                role="slider"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Scroll the lead grid"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(vtrack.pct * 100)}
                title="Drag to scroll, or use the arrows to step one lead at a time"
              >
                <i ref={vThumbRef} />
              </div>
              <button className="dc-nudge" onClick={() => vNudge(1)} disabled={vtrack.pct >= 0.999} title="Down one lead" aria-label="Down one lead">
                ▼
              </button>
            </div>
          )}
          {view === 'rack' && track.ratio < 1 && (
            <>
              <span className="fade l" style={{ opacity: track.pct > 0.01 ? 1 : 0 }} />
              <span className="fade r" style={{ opacity: track.pct < 0.99 ? 1 : 0 }} />
            </>
          )}
          <div
            className={view === 'rack' ? `dc-viewport${grabbing ? ' grabbing' : ''}` : 'dc-gridscroll'}
            ref={viewRef}
            onScroll={vMeasure}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onClickCapture={(e) => {
              if (swallow.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <div className={view === 'rack' ? 'dc-belt' : 'dc-leads'} ref={beltRef}>
              {/* A Fragment, not a wrapper div: `.dc-belt > *` carries the
                  card's flex-basis, so an extra element between the belt and
                  the card would take the sizing and leave the card unsized. */}
              {items.map((item) => (
                <Fragment key={keyOf(item)}>{renderItem(item)}</Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
