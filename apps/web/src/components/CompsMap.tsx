'use client';

import { useEffect, useRef } from 'react';

interface Comp {
  id: string;
  address: string;
  distance: number;
  soldPrice: number;
  soldDate: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  selected: boolean;
  correlation?: number;
  latitude?: number;
  longitude?: number;
}

interface Lead {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  latitude?: number;
  longitude?: number;
}

interface CompsMapProps {
  lead: Lead;
  comps: Comp[];
  compIndexMap?: Map<string, number>;
  hoveredCompId?: string | null;
  onHoverComp?: (id: string | null) => void;
  onToggleComp?: (compId: string) => void;
}

export default function CompsMap({
  lead,
  comps,
  compIndexMap,
  hoveredCompId,
  onHoverComp,
  onToggleComp,
}: CompsMapProps) {
  const mapRef        = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  // Stable refs so event listeners always call the latest callback
  // without being listed as useEffect deps (prevents map rebuilds)
  const onHoverRef  = useRef(onHoverComp);
  const onToggleRef = useRef(onToggleComp);
  useEffect(() => { onHoverRef.current  = onHoverComp;  }, [onHoverComp]);
  useEffect(() => { onToggleRef.current = onToggleComp; }, [onToggleComp]);

  // ── Build / rebuild map only when actual data changes ────────────────────
  // onToggleComp and onHoverComp are intentionally excluded from deps
  // (accessed via refs above) so hover/callback changes don't rebuild the map.
  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return;

    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const compsWithCoords = comps.filter((c) => c.latitude && c.longitude);
      const hasSubject      = !!(lead.latitude && lead.longitude);
      if (!hasSubject && compsWithCoords.length === 0) return;

      const centerLat = hasSubject ? lead.latitude!  : compsWithCoords[0].latitude!;
      const centerLng = hasSubject ? lead.longitude! : compsWithCoords[0].longitude!;

      const map = L.map(mapRef.current!, { zoomControl: true }).setView([centerLat, centerLng], 14);
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];

      // Subject property marker
      if (hasSubject) {
        const subjectIcon = L.divIcon({
          className: '',
          html: `<div style="
            background:#dc2626;color:white;border:3px solid white;
            border-radius:50%;width:32px;height:32px;
            display:flex;align-items:center;justify-content:center;
            font-weight:bold;font-size:13px;
            box-shadow:0 2px 6px rgba(0,0,0,0.4);
          ">S</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        L.marker([lead.latitude!, lead.longitude!], { icon: subjectIcon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:180px">
              <strong>Subject Property</strong><br/>
              <span style="color:#555">${lead.propertyAddress}</span><br/>
              ${lead.bedrooms || '?'}bd / ${lead.bathrooms || '?'}ba / ${lead.sqft?.toLocaleString() || '?'} sqft
            </div>
          `);
        bounds.push([lead.latitude!, lead.longitude!]);
      }

      // Comp markers
      compsWithCoords.forEach((comp) => {
        const isSelected  = comp.selected;
        const color       = isSelected ? '#2563eb' : '#9ca3af';
        const displayNum  = compIndexMap?.get(comp.id) ?? '?';
        const correlation = comp.correlation ? Math.round(comp.correlation * 100) : null;
        const monthsAgo   = Math.round(
          (Date.now() - new Date(comp.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000),
        );

        const compIcon = L.divIcon({
          className: '',
          html: `<div
            data-comp-marker="${comp.id}"
            style="
              background:${color};color:white;border:2px solid white;
              border-radius:50%;width:28px;height:28px;
              display:flex;align-items:center;justify-content:center;
              font-weight:bold;font-size:11px;
              box-shadow:0 2px 4px rgba(0,0,0,0.3);
              cursor:pointer;
              transition:transform 0.12s ease,box-shadow 0.12s ease;
            ">${displayNum}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([comp.latitude!, comp.longitude!], {
          icon: compIcon,
          zIndexOffset: isSelected ? 500 : 100,
        }).addTo(map);

        // Popup on CLICK only — not on hover, so the map doesn't pan/jump
        marker.bindPopup(`
          <div style="min-width:200px">
            <strong>#${displayNum} · ${comp.address}</strong><br/>
            <span style="color:#16a34a;font-weight:bold;font-size:16px">$${comp.soldPrice.toLocaleString()}</span><br/>
            ${comp.bedrooms || '?'}bd / ${comp.bathrooms || '?'}ba / ${comp.sqft?.toLocaleString() || '?'} sqft<br/>
            <span style="color:#555">${comp.distance.toFixed(2)} mi · sold ${monthsAgo}mo ago</span><br/>
            ${correlation ? `<strong style="color:${correlation >= 90 ? '#16a34a' : correlation >= 80 ? '#ca8a04' : '#dc2626'}">${correlation}% match</strong>` : ''}
            ${isSelected ? ' · <span style="color:#2563eb">✓ Selected</span>' : ''}
            <br/><button
              onclick="window.__compsToggle('${comp.id}')"
              style="margin-top:6px;padding:3px 10px;background:${isSelected ? '#e5e7eb' : '#2563eb'};color:${isSelected ? '#374151' : 'white'};border:none;border-radius:4px;cursor:pointer;font-size:12px"
            >${isSelected ? 'Deselect' : 'Select'}</button>
          </div>
        `, { autoPan: false }); // autoPan:false prevents map jumping when popup opens

        // Hover: just highlight marker via DOM — no popup, no map pan
        marker.on('mouseover', () => { onHoverRef.current?.(comp.id); });
        marker.on('mouseout',  () => { onHoverRef.current?.(null); });

        bounds.push([comp.latitude!, comp.longitude!]);
      });

      // Global toggle handler — reads from ref so it always calls the latest version
      (window as any).__compsToggle = (id: string) => {
        onToggleRef.current?.(id);
      };

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  // NOTE: onToggleComp and onHoverComp intentionally omitted — using refs above
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, comps, compIndexMap]);

  // ── Hover highlight — pure DOM mutation, zero map rebuild ─────────────────
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('[data-comp-marker]').forEach((el) => {
      el.style.transform  = 'scale(1)';
      el.style.boxShadow  = '0 2px 4px rgba(0,0,0,0.3)';
      el.style.zIndex     = '';
    });
    if (hoveredCompId) {
      const el = document.querySelector<HTMLElement>(`[data-comp-marker="${hoveredCompId}"]`);
      if (el) {
        el.style.transform = 'scale(1.45)';
        el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.55)';
        el.style.zIndex    = '999';
      }
    }
  }, [hoveredCompId]);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <div ref={mapRef} className="w-full h-96 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 z-0" />
      <div className="mt-3 flex flex-wrap gap-5 text-sm items-center">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-600 rounded-full border-2 border-white shadow" />
          <span className="text-gray-600 dark:text-gray-400">Subject Property</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow" />
          <span className="text-gray-600 dark:text-gray-400">Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-400 dark:bg-gray-500 rounded-full border-2 border-white shadow" />
          <span className="text-gray-600 dark:text-gray-400">Unselected</span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 italic">Hover to highlight · click marker to select/deselect</span>
      </div>
    </>
  );
}
