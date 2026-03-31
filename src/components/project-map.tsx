'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import { LatLngBoundsExpression } from 'leaflet';
import { formatCurrency, formatPhone } from '@/lib/format';
import { buildTradeRelevance } from '@/lib/permits/trade-utils';
import type { PermitProject } from '@/lib/permits/types';

type Props = {
  projects: PermitProject[];
  trade: string;
};

type Cluster = {
  id: string;
  lat: number;
  lon: number;
  projects: PermitProject[];
};

function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [bounds, map]);
  return null;
}

function buildClusters(projects: PermitProject[]): Cluster[] {
  const buckets = new Map<string, PermitProject[]>();

  for (const project of projects) {
    if (project.coordinates.lat === null || project.coordinates.lon === null) continue;
    const bucketLat = Math.round(project.coordinates.lat / 0.025);
    const bucketLon = Math.round(project.coordinates.lon / 0.025);
    const key = `${bucketLat}:${bucketLon}`;
    const existing = buckets.get(key) || [];
    existing.push(project);
    buckets.set(key, existing);
  }

  return [...buckets.entries()].map(([key, groupedProjects]) => ({
    id: key,
    lat: groupedProjects.reduce((sum, project) => sum + (project.coordinates.lat || 0), 0) / groupedProjects.length,
    lon: groupedProjects.reduce((sum, project) => sum + (project.coordinates.lon || 0), 0) / groupedProjects.length,
    projects: groupedProjects.sort((left, right) => right.issueDate.localeCompare(left.issueDate))
  }));
}

export function ProjectMap({ projects, trade }: Props) {
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const clusters = useMemo(() => buildClusters(projects), [projects]);

  const bounds = useMemo<LatLngBoundsExpression>(
    () =>
      clusters.length
        ? clusters.map((cluster) => [cluster.lat, cluster.lon] as [number, number])
        : [
            [36.12, -86.92],
            [36.22, -86.68]
          ],
    [clusters]
  );

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[rgba(15,16,18,0.8)] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-all duration-300">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] h-24 bg-[linear-gradient(180deg,rgba(0,0,0,0.28),transparent)]" />
      <MapContainer bounds={bounds} scrollWheelZoom={false} className="h-[420px] w-full rounded-[26px]">
        <FitToBounds bounds={bounds} />
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {clusters.map((cluster) => (
          <CircleMarker
            key={cluster.id}
            center={[cluster.lat, cluster.lon]}
            radius={Math.min(14 + cluster.projects.length * 1.2, 26)}
            pathOptions={{
              color: cluster.projects.length > 1 ? '#b45309' : '#1c1917',
              fillColor: cluster.projects.length > 1 ? '#f59e0b' : '#1c1917',
              fillOpacity: 0.88,
              weight: 2
            }}
            eventHandlers={{
              click: () => setSelectedCluster(cluster)
            }}
          />
        ))}
      </MapContainer>

      <div className="pointer-events-none absolute left-4 top-4 z-[600] rounded-full border border-white/10 bg-[rgba(15,16,18,0.72)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-200 backdrop-blur">
        {clusters.length} map points
      </div>

      {selectedCluster ? (
        <div className="absolute inset-x-3 bottom-3 z-[700] rounded-[26px] border border-white/10 bg-[rgba(15,16,18,0.92)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                {selectedCluster.projects.length > 1 ? `${selectedCluster.projects.length} nearby permits` : 'Project preview'}
              </div>
              <h3 className="mt-2 text-lg font-semibold text-white">{selectedCluster.projects[0]?.address || 'Address pending'}</h3>
            </div>
            <button onClick={() => setSelectedCluster(null)} className="text-sm font-semibold text-stone-400 active:scale-[0.98]">
              Close
            </button>
          </div>

          {selectedCluster.projects[0] ? (
            <>
              <p className="mt-2 text-sm text-stone-300">{selectedCluster.projects[0].permitSubtype || selectedCluster.projects[0].permitType}</p>
              <p className="mt-3 text-sm leading-6 text-stone-200">{selectedCluster.projects[0].readableSummary}</p>
              <p className="mt-2 text-sm leading-6 text-amber-200">{buildTradeRelevance(selectedCluster.projects[0], trade)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="text-sm font-semibold text-stone-100">{formatCurrency(selectedCluster.projects[0].valuation)}</div>
                {selectedCluster.projects[0].contactPhone ? (
                  <a href={`tel:${selectedCluster.projects[0].contactPhone.replace(/[^\d+]/g, '')}`} className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950 active:scale-[0.98]">
                    Call {formatPhone(selectedCluster.projects[0].contactPhone)}
                  </a>
                ) : null}
                <a href={`/projects/${selectedCluster.projects[0].id}${trade ? `?trade=${encodeURIComponent(trade)}` : ''}`} className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-stone-100 active:scale-[0.98]">
                  Open project
                </a>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
