import { GcActivitySnapshot, GcEntity } from '@prisma/client';
import { formatCurrency, formatDate } from '@/lib/format';

type Snapshot = GcActivitySnapshot & { gcEntity: GcEntity };

export function HotGcs({ snapshots }: { snapshots: Snapshot[] }) {
  return (
    <section className="space-y-3">
      {snapshots.map((row) => (
        <article className="rounded-xl border border-slate-200 bg-white p-4" key={row.id}>
          <h3 className="text-base font-semibold text-slate-900">{row.gcEntity.canonicalName}</h3>
          <p className="text-sm text-slate-700">
            {row.projectCount90d} projects • {formatCurrency(Number(row.totalValuation90d || 0))} total valuation
          </p>
          <p className="text-sm text-slate-700">Most recent permit: {formatDate(row.mostRecentPermitDate)}</p>
          <p className="mt-2 text-sm text-slate-800">{row.profileNote || 'Active across current cycle.'}</p>
        </article>
      ))}
    </section>
  );
}
