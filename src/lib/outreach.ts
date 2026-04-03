import type { ActiveContact, PermitProject } from '@/lib/permits/types';

export type OutreachProfile = {
  fullName?: string;
  businessName?: string;
  trade?: string;
  phone?: string;
  email?: string;
  serviceDescription?: string;
};

function clean(value?: string | null): string {
  return (value || '').trim();
}

function firstName(value: string): string {
  const normalized = clean(value);
  if (!normalized) return '';
  const [first] = normalized.split(/\s+/);
  return first || normalized;
}

function buildTradeLine(profile: OutreachProfile): string {
  const trade = clean(profile.trade);
  const serviceDescription = clean(profile.serviceDescription);

  if (serviceDescription) return serviceDescription;
  if (trade) return trade.toLowerCase();
  return 'commercial subcontracting work';
}

function buildSignature(profile: OutreachProfile): string {
  const parts = [clean(profile.fullName), clean(profile.businessName)].filter(Boolean);
  const contact = [clean(profile.phone), clean(profile.email)].filter(Boolean).join(' | ');
  return [parts.join(' - '), contact].filter(Boolean).join('\n');
}

function buildMailto(email: string, subject: string, body: string): string {
  const params = new URLSearchParams({
    subject,
    body
  });
  return `mailto:${email}?${params.toString()}`;
}

export function buildProjectOutreachMailto(project: PermitProject, profile: OutreachProfile): string | null {
  const email = clean(project.contactEmail);
  if (!email) return null;

  const greetingName = firstName(project.contactName) || 'there';
  const tradeLine = buildTradeLine(profile);
  const companyName = clean(profile.businessName) || 'my company';
  const summary = clean(project.readableSummary || project.purpose || project.permitSubtype || project.permitType);
  const subject = `${clean(profile.trade) || 'Trade support'} for ${project.address}`;
  const body = [
    `Hi ${greetingName},`,
    '',
    `I saw the permit for ${project.address}.`,
    `My company, ${companyName}, specializes in ${tradeLine}.`,
    summary ? `It looks like the scope involves ${summary.charAt(0).toLowerCase()}${summary.slice(1)}.` : '',
    "If you need help on this project, I'd love to connect.",
    '',
    buildSignature(profile)
  ]
    .filter(Boolean)
    .join('\n');

  return buildMailto(email, subject, body);
}

export function buildContactOutreachMailto(contact: ActiveContact, profile: OutreachProfile): string | null {
  const email = clean(contact.email);
  if (!email) return null;

  const greetingName = firstName(contact.name) || 'there';
  const tradeLine = buildTradeLine(profile);
  const companyName = clean(profile.businessName) || 'my company';
  const address = clean(contact.mostRecentPermitAddress);
  const scope = clean(contact.mostRecentPermitSummary || contact.mostRecentPermitType);
  const subject = `${clean(profile.trade) || 'Trade support'} for ${address || 'your Jacksonville permit work'}`;
  const body = [
    `Hi ${greetingName},`,
    '',
    address ? `I saw the recent permit activity at ${address}.` : 'I saw your recent permit activity in Jacksonville.',
    `My company, ${companyName}, specializes in ${tradeLine}.`,
    scope ? `The recent scope looked like ${scope.charAt(0).toLowerCase()}${scope.slice(1)}.` : '',
    "If you need help on this project, I'd love to connect.",
    '',
    buildSignature(profile)
  ]
    .filter(Boolean)
    .join('\n');

  return buildMailto(email, subject, body);
}
