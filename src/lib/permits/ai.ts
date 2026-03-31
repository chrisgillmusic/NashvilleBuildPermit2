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
const AI_CACHE_TTL_MS = 1000 * 60 * 2;

const narrativeCache = new Map<string, { createdAt: number; promise: Promise<AiNarrative | null> }>();

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
  if (!enabled()) {
    console.log('AI SKIPPED: missing key');
    return null;
  }

  const key = buildKey(input);
  const cached = narrativeCache.get(key);
  if (cached && Date.now() - cached.createdAt < AI_CACHE_TTL_MS) {
    console.log('AI SKIPPED: cache hit');
    return cached.promise;
  }

  const promise = (async () => {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: OPENAI_API_URL
    });

    try {
      const prompt = [
        'Summarize this construction permit for a subcontractor in 1 sentence preferred, 2 short sentences max.',
        'Write like a real person quickly explaining the job to a subcontractor.',
        'Be direct, useful, short, specific, and human.',
        'Do not sound corporate, promotional, or generic.',
        'Do not copy permit sludge unless absolutely necessary.',
        'Return strict JSON with keys: snapshot, whyItMatters, tradeNote.',
        'snapshot: one clean summary sentence about the actual work.',
        'whyItMatters: one short note only if it adds something new beyond snapshot. Otherwise return an empty string.',
        'tradeNote: one short selected-trade note only if it adds something new beyond snapshot and whyItMatters. Otherwise return an empty string.',
        'Avoid duplicated phrasing across all three fields.',
        'Do not imply roofing if the permit says no change to exterior, no roofline change, interior only, or similar.',
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
        new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), AI_TIMEOUT_MS);
        })
      ]);

      if (response === 'timeout') {
        console.log('AI SKIPPED: timeout');
        return null;
      }

      const outputText = response.output_text?.trim() || '';
      if (!outputText) {
        console.log('AI SKIPPED: empty output');
        return null;
      }

      const narrative = extractJson(outputText);
      if (!narrative) {
        console.log('AI SKIPPED: parse failed');
        console.log('AI RESULT:', outputText);
        return null;
      }
      console.log('AI SUCCESS');
      console.log('AI RESULT:', narrative);
      return narrative;
    } catch (error) {
      console.log('AI SKIPPED: request failed', error);
      return null;
    }
  })();

  narrativeCache.set(key, { createdAt: Date.now(), promise });
  return promise;
}
