import type { ActiveContact, OutreachDraft, PermitProject } from '@/lib/permits/types';

export type OutreachProfile = {
  fullName?: string;
  businessName?: string;
  trade?: string;
  phone?: string;
  email?: string;
  serviceDescription?: string;
};

type OutreachTemplate = {
  projectIntro: string;
  contactIntro: string;
  close: string;
};

const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  { projectIntro: 'I saw the recent permit activity at {{address}}.', contactIntro: 'I saw your recent permit activity at {{address}}.', close: "If you need support on this project, I'd love to connect." },
  { projectIntro: 'I noticed the permit filed for {{address}}.', contactIntro: 'I noticed the recent permit activity tied to {{address}}.', close: "If you're still filling out trades, I'd be glad to connect." },
  { projectIntro: 'Reaching out after seeing the work at {{address}}.', contactIntro: 'Reaching out after seeing your permit activity at {{address}}.', close: "If you need help on the scope there, I'd be happy to talk." },
  { projectIntro: 'Wanted to introduce myself after seeing the permit at {{address}}.', contactIntro: 'Wanted to introduce myself after seeing your recent permit at {{address}}.', close: "If this job still needs trade support, I'd love to connect." },
  { projectIntro: 'I came across the permit for {{address}}.', contactIntro: 'I came across your recent permit activity at {{address}}.', close: 'If this project needs another trade partner, I would be glad to help.' },
  { projectIntro: 'I was looking through recent Jacksonville permits and saw {{address}}.', contactIntro: 'I was looking through recent Jacksonville permits and saw your activity at {{address}}.', close: 'If you need support on the work there, I would be glad to connect.' },
  { projectIntro: 'I saw the permit work tied to {{address}}.', contactIntro: 'I saw your permit work tied to {{address}}.', close: "If you're still lining up help on the project, I'd be happy to talk." },
  { projectIntro: 'I noticed recent permit activity at {{address}}.', contactIntro: 'I noticed your recent permit activity at {{address}}.', close: "If you'd like another trade contact for the job, I'd love to connect." },
  { projectIntro: 'I saw the permit scope connected to {{address}}.', contactIntro: 'I saw your recent permit scope connected to {{address}}.', close: 'If you need an extra hand on the project, feel free to reach out.' },
  { projectIntro: 'I was checking recent permit filings and saw {{address}}.', contactIntro: 'I was checking recent permit filings and saw your work at {{address}}.', close: "If there's still room for support on the job, I'd be glad to connect." },
  { projectIntro: 'I saw the recent filing for {{address}}.', contactIntro: 'I saw your recent filing for {{address}}.', close: "If you need support on this one, I'd be happy to talk." },
  { projectIntro: 'I noticed new permit activity at {{address}}.', contactIntro: 'I noticed new permit activity under your name at {{address}}.', close: 'If you need another trade partner, I would be glad to help.' },
  { projectIntro: 'I came across the work listed for {{address}}.', contactIntro: 'I came across your recent work listed for {{address}}.', close: 'If this project still needs trade coverage, I would be glad to connect.' },
  { projectIntro: 'I saw the permit details for {{address}} come through.', contactIntro: 'I saw your permit details for {{address}} come through.', close: "If you'd like to compare availability, I'd be glad to talk." },
  { projectIntro: 'I was reviewing current Jacksonville permit activity and saw {{address}}.', contactIntro: 'I was reviewing current Jacksonville permit activity and saw your permit at {{address}}.', close: 'If you need support on the scope there, I would be glad to connect.' },
  { projectIntro: 'I noticed the permit filed on {{address}}.', contactIntro: 'I noticed your recent permit filed on {{address}}.', close: "If you need another trade contact for the work, I'd be happy to help." },
  { projectIntro: 'I saw the recent work filed at {{address}}.', contactIntro: 'I saw your recent work filed at {{address}}.', close: 'If you still need help on the project, I would be glad to talk.' },
  { projectIntro: 'I came across the permit activity at {{address}}.', contactIntro: 'I came across your recent permit activity at {{address}}.', close: "If there's still trade coverage to line up, I'd love to connect." },
  { projectIntro: 'I noticed the permit tied to {{address}} in the latest Jacksonville activity.', contactIntro: 'I noticed your permit tied to {{address}} in the latest Jacksonville activity.', close: 'If you need support there, I would be glad to connect.' },
  { projectIntro: 'I saw the project activity at {{address}} and wanted to reach out.', contactIntro: 'I saw your project activity at {{address}} and wanted to reach out.', close: "If you'd like to keep another trade contact handy, I'd be glad to talk." },
  { projectIntro: 'I was reviewing recent permits and saw the work at {{address}}.', contactIntro: 'I was reviewing recent permits and saw your work at {{address}}.', close: 'If the project needs support, I would be glad to help.' },
  { projectIntro: 'I noticed the permit scope at {{address}} and wanted to introduce myself.', contactIntro: 'I noticed your permit scope at {{address}} and wanted to introduce myself.', close: 'If you need another trade partner on the project, feel free to reach out.' },
  { projectIntro: 'I saw recent permit movement at {{address}}.', contactIntro: 'I saw recent permit movement tied to your team at {{address}}.', close: "If you're still staffing the job, I'd be happy to connect." },
  { projectIntro: 'I came across the permit for work at {{address}}.', contactIntro: 'I came across your recent permit for work at {{address}}.', close: "If there's a need for support on the scope, I'd be glad to talk." },
  { projectIntro: 'I noticed the recent permit listed for {{address}}.', contactIntro: 'I noticed your recent permit listed for {{address}}.', close: 'If you need another trade contact, I would be glad to help.' },
  { projectIntro: 'I saw the permit activity for {{address}} and wanted to reach out directly.', contactIntro: 'I saw your permit activity for {{address}} and wanted to reach out directly.', close: 'If the job still needs support, I would be glad to connect.' },
  { projectIntro: 'I was watching Jacksonville permit activity and saw {{address}} come up.', contactIntro: 'I was watching Jacksonville permit activity and saw your job at {{address}} come up.', close: "If you need support on that scope, I'd be happy to talk." },
  { projectIntro: 'I noticed the recent filing connected to {{address}}.', contactIntro: 'I noticed your recent filing connected to {{address}}.', close: "If you're still building out the team, I'd be glad to connect." },
  { projectIntro: 'I saw the current permit work at {{address}}.', contactIntro: 'I saw your current permit work at {{address}}.', close: 'If you need trade support on the project, I would be glad to help.' },
  { projectIntro: 'I came across the latest permit at {{address}} and wanted to introduce our company.', contactIntro: 'I came across your latest permit at {{address}} and wanted to introduce our company.', close: "If you'd like to connect on the project, I'd be glad to reach out." }
];

function clean(value?: string | null): string {
  return (value || '').trim();
}

function firstName(value: string): string {
  const normalized = clean(value);
  if (!normalized) return '';
  const [first] = normalized.split(/\s+/);
  return first || normalized;
}

function buildSignature(profile: OutreachProfile): string {
  const nameLine = [clean(profile.fullName), clean(profile.businessName)].filter(Boolean).join(' – ');
  const contactLine = [clean(profile.phone), clean(profile.email)].filter(Boolean).join(' | ');
  const lines = [
    nameLine,
    contactLine
  ].filter(Boolean);

  return lines.join('\r\n');
}

function encodeMailtoPart(value: string): string {
  return encodeURIComponent(value);
}

function buildMailto(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeMailtoPart(subject)}&body=${encodeMailtoPart(body)}`;
}

function normalizeTradeKey(value: string): string {
  return clean(value).toLowerCase();
}

function tradeKeyCandidates(value: string): string[] {
  const normalized = normalizeTradeKey(value);
  const candidates = new Set<string>([normalized]);

  if (normalized === 'hvac') candidates.add('mechanical');
  if (normalized === 'mechanical') candidates.add('hvac');
  if (normalized === 'general interiors') candidates.add('general construction');
  if (normalized === 'general construction') candidates.add('general interiors');
  if (normalized === 'framing') candidates.add('general construction');
  if (normalized === 'concrete') candidates.add('sitework');
  if (normalized === 'sitework') candidates.add('concrete');

  return [...candidates];
}

function findStoredOutreachDraft(outreachByTrade: Record<string, OutreachDraft> | undefined, trade: string): OutreachDraft | null {
  if (!outreachByTrade || !trade.trim()) return null;

  const candidates = tradeKeyCandidates(trade);
  for (const [key, draft] of Object.entries(outreachByTrade)) {
    const normalizedKey = normalizeTradeKey(key);
    if (!normalizedKey) continue;
    if (candidates.some((candidate) => normalizedKey === candidate || normalizedKey.includes(candidate) || candidate.includes(normalizedKey))) {
      return draft;
    }
  }

  return null;
}

function hydrateStoredDraft(draft: OutreachDraft, profile: OutreachProfile, recipientName: string, companyName: string): OutreachDraft {
  const replacements: Record<string, string> = {
    '[Name]': firstName(recipientName) || recipientName || 'there',
    '[Company]': clean(companyName) || clean(recipientName) || 'your team',
    '[Business Name]': clean(profile.businessName) || 'My company',
    '[Sender Full Name]': clean(profile.fullName) || '',
    '[Phone]': clean(profile.phone) || '',
    '[Email]': clean(profile.email) || ''
  };

  const replaceTokens = (value: string) => {
    let next = value;
    for (const [token, replacement] of Object.entries(replacements)) {
      next = next.replaceAll(token, replacement);
    }
    return next
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return {
    subject: replaceTokens(draft.subject || ''),
    body: replaceTokens(draft.body || '')
  };
}

function selectTemplate(index: number): OutreachTemplate {
  return OUTREACH_TEMPLATES[((index % OUTREACH_TEMPLATES.length) + OUTREACH_TEMPLATES.length) % OUTREACH_TEMPLATES.length];
}

function buildCommonLine(profile: OutreachProfile): string {
  const companyName = clean(profile.businessName) || 'my company';
  const trade = clean(profile.trade).toLowerCase() || 'commercial subcontracting work';
  return `My company, ${companyName}, specializes in ${trade}.`;
}

function buildScopeLine(scope: string): string {
  const normalized = clean(scope);
  if (!normalized) return '';
  const sentence = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  return `The scope looks like ${sentence}.`;
}

export function buildProjectOutreachMailto(project: PermitProject, profile: OutreachProfile, templateIndex = 0, selectedTrade = ''): string | null {
  const email = clean(project.contactEmail);
  if (!email) return null;

  const storedDraft = findStoredOutreachDraft(project.outreachByTrade, selectedTrade);
  if (storedDraft) {
    const hydrated = hydrateStoredDraft(storedDraft, profile, project.contactName, project.contactName);
    return buildMailto(email, hydrated.subject || `${clean(profile.trade) || 'Trade support'} for ${project.address}`, hydrated.body);
  }

  const template = selectTemplate(templateIndex);
  const greetingName = firstName(project.contactName) || 'there';
  const subject = `${clean(profile.trade) || 'Trade support'} for ${project.address}`;
  const body = [
    `Hi ${greetingName},`,
    '',
    template.projectIntro.replace('{{address}}', project.address),
    buildCommonLine(profile),
    buildScopeLine(project.readableSummary || project.purpose || project.permitSubtype || project.permitType),
    template.close,
    '',
    buildSignature(profile)
  ]
    .filter(Boolean)
    .join('\r\n');

  return buildMailto(email, subject, body);
}

export function buildContactOutreachMailto(contact: ActiveContact, profile: OutreachProfile, templateIndex = 0): string | null {
  const email = clean(contact.email);
  if (!email) return null;

  const storedDraft = findStoredOutreachDraft(contact.mostRecentOutreachByTrade, clean(profile.trade));
  if (storedDraft) {
    const hydrated = hydrateStoredDraft(storedDraft, profile, contact.name, contact.name);
    const subject = hydrated.subject || `${clean(profile.trade) || 'Trade support'} for ${clean(contact.mostRecentPermitAddress) || 'your Jacksonville permit work'}`;
    return buildMailto(email, subject, hydrated.body);
  }

  const template = selectTemplate(templateIndex);
  const greetingName = firstName(contact.name) || 'there';
  const address = clean(contact.mostRecentPermitAddress) || 'your Jacksonville permit work';
  const subject = `${clean(profile.trade) || 'Trade support'} for ${address}`;
  const body = [
    `Hi ${greetingName},`,
    '',
    template.contactIntro.replace('{{address}}', address),
    buildCommonLine(profile),
    buildScopeLine(contact.mostRecentPermitSummary || contact.mostRecentPermitType || ''),
    template.close,
    '',
    buildSignature(profile)
  ]
    .filter(Boolean)
    .join('\r\n');

  return buildMailto(email, subject, body);
}

export const OUTREACH_TEMPLATE_COUNT = OUTREACH_TEMPLATES.length;
