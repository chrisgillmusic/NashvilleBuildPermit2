import 'server-only';

type NarrativeInput = {
  permitNumber: string;
  permitType: string;
  permitSubtype: string;
  purpose: string;
  valuation: number;
  trade: string;
  likelyTrades: string[];
};

export type AiNarrative = {
  snapshot: string;
  whyItMatters: string;
  tradeNote: string;
};

const AI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 6000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';

const narrativeCache = new Map<string, Promise<AiNarrative | null>>();

function buildKey(input: NarrativeInput): string {
  return [
    input.permitNumber,
    input.trade,
    input.permitType,
    input.permitSubtype,
    input.purpose,
    input.valuation,
    input.likelyTrades.join(',')
  ].join('::');
}

function enabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function extractJson(text: string): AiNarrative | null {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<AiNarrative>;
    if (!parsed.snapshot || !parsed.tradeNote) return null;
    return {
      snapshot: parsed.snapshot.trim(),
      whyItMatters: (parsed.whyItMatters || '').trim(),
      tradeNote: parsed.tradeNote.trim()
    };
  } catch {
    return null;
  }
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };

  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();

  const chunks =
    data.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text || '')
      .filter(Boolean) || [];

  return chunks.join('\n').trim();
}

export async function generateAiNarrative(input: NarrativeInput): Promise<AiNarrative | null> {
  if (!enabled()) return null;

  const key = buildKey(input);
  const cached = narrativeCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: [
            {
              role: 'developer',
              content: [
                {
                  type: 'input_text',
                  text:
                    'You rewrite permit descriptions for a mobile construction intelligence app. Return compact JSON with keys snapshot, whyItMatters, tradeNote. Keep each value short. Plain English only. No hype, no jargon, no duplication. Do not imply a trade unless the permit makes it plausible. If permit text says no exterior or no roof work, do not imply roofing.'
                }
              ]
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    permitNumber: input.permitNumber,
                    permitType: input.permitType,
                    permitSubtype: input.permitSubtype,
                    purpose: input.purpose,
                    valuation: input.valuation,
                    selectedTrade: input.trade || null,
                    likelyTrades: input.likelyTrades
                  })
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) return null;

      const payload = (await response.json()) as unknown;
      const outputText = extractOutputText(payload);
      if (!outputText) return null;

      return extractJson(outputText);
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  narrativeCache.set(key, promise);
  return promise;
}
