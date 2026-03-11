import { Project } from '@prisma/client';
import { formatCurrency, formatDate } from '@/lib/format';
import { toGoogleMapsLink } from '@/lib/text/normalize';

type Props = {
  project: Project;
  scope: string;
  note: string;
  contactName?: string | null;
};

export function ProjectCard({ project, scope, note, contactName }: Props) {
  const mapLink = toGoogleMapsLink([project.address, project.city, project.state, project.zip]);

  return (
    <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{project.phaseBucket}</p>
      <h3 className="mt-1 text-base font-semibold text-slate-900">{project.address || 'Address pending'}</h3>
      <p className="text-sm text-slate-700">Permit {project.permitNumber || 'N/A'} • {project.permitSubtypeDescription || 'Subtype N/A'}</p>
      <p className="mt-2 text-sm text-slate-800">{scope}</p>
      <p className="mt-2 text-sm text-slate-800">{note}</p>
      <p className="mt-2 text-sm text-slate-700">
        {formatCurrency(Number(project.constructionCost || 0))} • Issued {formatDate(project.dateIssued)}
      </p>
      <p className="text-sm text-slate-700">Contact: {contactName || project.contactRaw || 'Not listed'}</p>
      <a className="mt-3 inline-block text-sm font-semibold text-amber-700 underline" href={mapLink} target="_blank" rel="noreferrer">
        Open in Google Maps
      </a>
    </article>
  );
}
