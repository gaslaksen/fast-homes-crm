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
  onToggleComp?: (compId: string) => void;
}

export default function CompsMap({ lead, comps, onToggleComp }: CompsMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return;

    // Dynamically import leaflet (client-side only)
    import('leaflet').then((L) => {
      // Fix default marker icons (Next.js bundling issue)
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Destroy existing map if re-rendering
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const compsWithCoords = comps.filter((c) => c.latitude && c.longitude);
      const hasSubjectCoords = lead.latitude && lead.longitude;

      if (!hasSubjectCoords && compsWithCoords.length === 0) return;

      const centerLat = hasSubjectCoords ? lead.latitude! : compsWithCoords[0].latitude!;
      const centerLng = hasSubjectCoords ? lead.longitude! : compsWithCoords[0].longitude!;

      const map = L.map(mapRef.current!, { zoomControl: true }).setView([centerLat, centerLng], 14);
      mapInstanceRef.current = map;

      // OpenStreetMap tiles — free, no API key
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];

      // Subject property marker (red)
      if (hasSubjectCoords) {
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
      compsWithCoords.forEach((comp, index) => {
        const isSelected = comp.selected;
        const correlation = comp.correlation ? Math.round(comp.correlation * 100) : null;
        const color = isSelected ? '#2563eb' : '#9ca3af';

        const compIcon = L.divIcon({
          className: '',
          html: `<div style="
            background:${color};color:white;border:2px solid white;
            border-radius:50%;width:28px;height:28px;
            display:flex;align-items:center;justify-content:center;
            font-weight:bold;font-size:11px;
            box-shadow:0 2px 4px rgba(0,0,0,0.3);
            cursor:pointer;
          ">${index + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const monthsAgo = Math.round((Date.now() - new Date(comp.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000));

        const marker = L.marker([comp.latitude!, comp.longitude!], {
          icon: compIcon,
          zIndexOffset: isSelected ? 500 : 100,
        }).addTo(map);

        marker.bindPopup(`
          <div style="min-width:200px">
            <strong>#${index + 1} ${comp.address}</strong><br/>
            <span style="color:#16a34a;font-weight:bold;font-size:16px">$${comp.soldPrice.toLocaleString()}</span><br/>
            ${comp.bedrooms || '?'}bd / ${comp.bathrooms || '?'}ba / ${comp.sqft?.toLocaleString() || '?'} sqft<br/>
            <span style="color:#555">${comp.distance.toFixed(2)} mi · sold ${monthsAgo}mo ago</span><br/>
            ${correlation ? `<strong style="color:${correlation >= 90 ? '#16a34a' : correlation >= 80 ? '#ca8a04' : '#dc2626'}">${correlation}% match</strong>` : ''}
            ${isSelected ? ' · <span style="color:#2563eb">✓ Selected</span>' : ''}
            ${onToggleComp ? `<br/><button onclick="window.toggleComp('${comp.id}')" style="margin-top:6px;padding:3px 10px;background:${isSelected ? '#e5e7eb' : '#2563eb'};color:${isSelected ? '#374151' : 'white'};border:none;border-radius:4px;cursor:pointer;font-size:12px">${isSelected ? 'Deselect' : 'Select'}</button>` : ''}
          </div>
        `);

        bounds.push([comp.latitude!, comp.longitude!]);
      });

      // Expose toggle function globally for popup button
      if (onToggleComp) {
        (window as any).toggleComp = onToggleComp;
      }

      // Fit bounds if multiple points
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
  }, [lead, comps, onToggleComp]);

  return (
    <>
      {/* Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <div ref={mapRef} className="w-full h-96 rounded-lg border border-gray-300 bg-gray-100 z-0" />
      <div className="mt-3 flex gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-600 rounded-full border-2 border-white shadow" />
          <span className="text-gray-600">Subject Property</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow" />
          <span className="text-gray-600">Selected Comps</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-400 rounded-full border-2 border-white shadow" />
          <span className="text-gray-600">Unselected Comps</span>
        </div>
      </div>
    </>
  );
}
