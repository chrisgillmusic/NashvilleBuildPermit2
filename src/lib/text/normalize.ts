export function normalizeName(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, ' ').toUpperCase();
}

export function cleanPurposeSummary(value?: string | null): string {
  if (!value) return 'Scope not specified in permit detail.';
  const stripped = value
    .replace(/\bN\/A\b/gi, '')
    .replace(/\bSEE\s+ATTACHED\b/gi, '')
    .replace(/\bPER\s+PLANS?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return 'Scope not specified in permit detail.';

  const maxLen = 170;
  if (stripped.length <= maxLen) return stripped;

  const sliced = stripped.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${sliced.slice(0, Math.max(lastSpace, 120)).trim()}...`;
}

export function toGoogleMapsLink(parts: Array<string | null | undefined>): string {
  const query = parts.filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
}
