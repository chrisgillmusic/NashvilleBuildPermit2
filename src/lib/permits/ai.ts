import 'server-only';

import OpenAI from 'openai';

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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_URL = (process.env.OPENAI_API_URL || 'https://api.openai.com/v1').replace(/\/responses\/?$/, '');

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
    if (!parsed.snapshot) return null;
    return {
      snapshot: parsed.snapshot.trim(),
      whyItMatters: (parsed.whyItMatters || '').trim(),
      tradeNote: (parsed.tradeNote || '').trim()
    };
  } catch {
    return null;
  }
}

export async function generateAiNarrative(input: NarrativeInput): Promise<AiNarrative | null> {
  if (!enabled()) return null;

  const key = buildKey(input);
  const cached = narrativeCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: OPENAI_API_URL
    });

    try {
      const prompt = [
        'Summarize this construction permit for a subcontractor in 1-2 sentences max.',
        'Focus on what work is being done and why it is relevant.',
        'Avoid repetition. Be direct.',
        'Return JSON with keys: snapshot, whyItMatters, tradeNote.',
        'If whyItMatters or tradeNote would repeat snapshot, leave them empty.',
        'Do not imply roofing if the permit says there is no roof or exterior work.',
        JSON.stringify({
          permitNumber: input.permitNumber,
          permitType: input.permitType,
          permitSubtype: input.permitSubtype,
          purpose: input.purpose,
          valuation: input.valuation,
          selectedTrade: input.trade || null,
          likelyTrades: input.likelyTrades
        })
      ].join('\n');

      console.log('AI CALLED');

      const response = await Promise.race([
        client.responses.create({
          model: OPENAI_MODEL,
          input: prompt
        }),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), AI_TIMEOUT_MS);
        })
      ]);

      if (!response) return null;

      const outputText = response.output_text?.trim() || '';
      if (!outputText) return null;

      const narrative = extractJson(outputText);
      console.log('AI RESULT:', narrative);
      return narrative;
    } catch {
      return null;
    }
  })();

  narrativeCache.set(key, promise);
  return promise;
}
