'use client';

import { useRef, useEffect, useState } from 'react';

interface DealSearchResult {
  attomId: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  estimatedValue: number | null;
  equityPercent: number | null;
  distressFlags: string[];
  latitude: number | null;
  longitude: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  propertyType: string;
}

interface DealSearchMapProps {
  results: DealSearchResult[];
  onSelectProperty: (result: DealSearchResult) => void;
  hoveredId?: string | null;
}

function getMarkerColor(result: DealSearchResult): string {
  const flags = result.distressFlags;
  if (flags.includes('Foreclosure') || flags.includes('Pre-Foreclosure')) return '#ef4444'; // red
  if (flags.includes('Tax Lien') || flags.includes('Bankruptcy')) return '#f97316'; // orange
  if (flags.includes('Absentee Owner')) return '#eab308'; // yellow
  if ((result.equityPercent ?? 0) > 50) return '#22c55e'; // green
  return '#3b82f6'; // blue (default)
}

export default function DealSearchMap({ results, onSelectProperty, hoveredId }: DealSearchMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Load Leaflet dynamically (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadLeaflet = async () => {
      if ((window as any).L) {
        setLeafletLoaded(true);
        return;
      }
      // Load CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      // Load JS
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setLeafletLoaded(true);
      document.head.appendChild(script);
    };

    loadLeaflet();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || mapInstanceRef.current) return;
    const L = (window as any).L;

    mapInstanceRef.current = L.map(mapRef.current).setView([39.8283, -98.5795], 4); // Center of US
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
  }, [leafletLoaded]);

  // Update markers when results change
  useEffect(() => {
    if (!leafletLoaded || !mapInstanceRef.current) return;
    const L = (window as any).L;
    const map = mapInstanceRef.current;

    // Clear existing markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    const validResults = results.filter((r) => r.latitude && r.longitude);
    if (validResults.length === 0) return;

    const bounds: [number, number][] = [];

    validResults.forEach((result) => {
      const lat = result.latitude!;
      const lng = result.longitude!;
      bounds.push([lat, lng]);

      const color = getMarkerColor(result);
      const isHovered = result.attomId === hoveredId;
      const size = isHovered ? 14 : 10;

      const icon = L.divIcon({
        className: 'deal-search-marker',
        html: `<div style="
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
          ${isHovered ? 'transform: scale(1.3);' : ''}
        "></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([lat, lng], { icon, zIndexOffset: isHovered ? 500 : 100 });

      // Popup content
      const popupHtml = `
        <div style="min-width: 180px; font-size: 12px;">
          <div style="font-weight: 600; margin-bottom: 4px;">${result.propertyAddress}</div>
          <div style="color: #666; margin-bottom: 4px;">${result.propertyCity}, ${result.propertyState} ${result.propertyZip}</div>
          <div style="display: flex; gap: 8px; margin-bottom: 4px;">
            <span>${result.bedrooms ?? '?'}bd/${result.bathrooms ?? '?'}ba</span>
            <span>${result.sqft?.toLocaleString() ?? '?'} sqft</span>
          </div>
          ${result.estimatedValue ? `<div style="font-weight: 600;">AVM: $${result.estimatedValue.toLocaleString()}</div>` : ''}
          ${result.equityPercent != null ? `<div>Equity: ${result.equityPercent}%</div>` : ''}
          ${result.distressFlags.length > 0 ? `<div style="margin-top: 4px; color: #dc2626;">${result.distressFlags.join(' | ')}</div>` : ''}
          <button
            onclick="window.__dealSearchSelectProperty && window.__dealSearchSelectProperty('${result.attomId}')"
            style="margin-top: 6px; padding: 2px 8px; background: #0d9488; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;"
          >View Details</button>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    // Fit bounds
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [results, leafletLoaded, hoveredId]);

  // Register global callback for popup button clicks
  useEffect(() => {
    (window as any).__dealSearchSelectProperty = (attomId: string) => {
      const result = results.find((r) => r.attomId === attomId);
      if (result) onSelectProperty(result);
    };
    return () => {
      delete (window as any).__dealSearchSelectProperty;
    };
  }, [results, onSelectProperty]);

  return (
    <div className="relative w-full h-full min-h-[500px] rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      <div ref={mapRef} className="w-full h-full min-h-[500px]" />
      {!leafletLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <span className="text-gray-500">Loading map...</span>
        </div>
      )}
      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white dark:bg-gray-900 rounded-lg shadow-md p-3 text-xs z-[1000]">
        <div className="font-medium mb-1.5 text-gray-700 dark:text-gray-300">Legend</div>
        {[
          { color: '#ef4444', label: 'Foreclosure' },
          { color: '#f97316', label: 'Tax Lien / Bankruptcy' },
          { color: '#eab308', label: 'Absentee Owner' },
          { color: '#22c55e', label: 'High Equity' },
          { color: '#3b82f6', label: 'Other' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <div
              className="w-3 h-3 rounded-full border border-white"
              style={{ background: color, boxShadow: '0 0 2px rgba(0,0,0,0.3)' }}
            />
            <span className="text-gray-600 dark:text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
