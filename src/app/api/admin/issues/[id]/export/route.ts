import { NextRequest, NextResponse } from 'next/server';
import { formatCurrency, formatDate } from '@/lib/format';
import { getIssueWithHotGcs } from '@/lib/issue/generate';
import { toGoogleMapsLink } from '@/lib/text/normalize';

function renderText(issueData: NonNullable<Awaited<ReturnType<typeof getIssueWithHotGcs>>>) {
  const { issue, snapshots } = issueData;
  const sections = ['ON DECK', 'IN MOTION', 'CLOSING OUT'] as const;

  const lines: string[] = [];
  lines.push(issue.title, '', issue.introText, '');

  for (const section of sections) {
    lines.push(section);
    const rows = issue.projects.filter((p) => p.sectionName === section);
    for (const row of rows) {
      const p = row.project;
      const mapLink = toGoogleMapsLink([p.address, p.city, p.state, p.zip]);
      lines.push(
        `${p.address || 'Address pending'} | Permit ${p.permitNumber || 'N/A'} | ${p.permitSubtypeDescription || 'Subtype N/A'} | ${formatCurrency(Number(p.constructionCost || 0))} | Issued ${formatDate(p.dateIssued)} | Contact ${p.contactRaw || 'Not listed'}`
      );
      lines.push(`Scope: ${row.displayNote}`);
      lines.push(`Trade note: ${row.customTradeNote || p.likelyStageNote || ''}`);
      lines.push(`Map: ${mapLink}`);
      lines.push('');
    }
  }

  lines.push('HOT GCs');
  for (const gc of snapshots) {
    lines.push(
      `${gc.gcEntity.canonicalName} | ${gc.projectCount90d} projects | ${formatCurrency(Number(gc.totalValuation90d || 0))} | Most recent ${formatDate(gc.mostRecentPermitDate)} | ${gc.profileNote || ''}`
    );
  }

  lines.push('', issue.outroText);
  return lines.join('\n');
}

function renderHtml(issueData: NonNullable<Awaited<ReturnType<typeof getIssueWithHotGcs>>>) {
  const { issue, snapshots } = issueData;
  const sections = ['ON DECK', 'IN MOTION', 'CLOSING OUT'] as const;
  const sectionHtml = sections
    .map((section) => {
      const rows = issue.projects.filter((p) => p.sectionName === section);
      return `<h2>${section}</h2>${rows
        .map((row) => {
          const p = row.project;
          const mapLink = toGoogleMapsLink([p.address, p.city, p.state, p.zip]);
          return `<article><h3>${p.address || 'Address pending'}</h3><p>Permit ${p.permitNumber || 'N/A'} · ${p.permitSubtypeDescription || 'Subtype N/A'} · ${formatCurrency(Number(p.constructionCost || 0))} · Issued ${formatDate(p.dateIssued)}</p><p>Contact: ${p.contactRaw || 'Not listed'}</p><p>${row.displayNote}</p><p>${row.customTradeNote || p.likelyStageNote || ''}</p><p><a href="${mapLink}">Open in Google Maps</a></p></article>`;
        })
        .join('')}`;
    })
    .join('');

  const hotGcHtml = snapshots
    .map(
      (gc) =>
        `<li><strong>${gc.gcEntity.canonicalName}</strong> - ${gc.projectCount90d} projects, ${formatCurrency(Number(gc.totalValuation90d || 0))}, most recent ${formatDate(gc.mostRecentPermitDate)}. ${gc.profileNote || ''}</li>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${issue.title}</title></head><body><h1>${issue.title}</h1><p>${issue.introText.replace(/\n/g, '<br/>')}</p>${sectionHtml}<h2>HOT GCs</h2><ul>${hotGcHtml}</ul><p>${issue.outroText}</p></body></html>`;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const format = new URL(request.url).searchParams.get('format') || 'text';
  const data = await getIssueWithHotGcs(params.id);
  if (!data) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  if (format === 'html') {
    return new NextResponse(renderHtml(data), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="nashville-build-insider-${params.id}.html"`
      }
    });
  }

  return new NextResponse(renderText(data), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="nashville-build-insider-${params.id}.txt"`
    }
  });
}
