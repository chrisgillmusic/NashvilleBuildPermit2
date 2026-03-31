import 'server-only';

import OpenAI from 'openai';

type NarrativeInput = {
  permitNumber: string;
  address: string;
  permitType: string;
  permitSubtype: string;
  purpose: string;
  valuation: number;
  trade: string;
  neighborhood: string;
  contactName: string;
  timeBucket: string;
  likelyTrades: string[];
};

export type AiInterpretation = {
  summary: string;
  whyItMatters: string;
  tradeReason: string;
  isTradeRelevant: boolean;
};

const AI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 6000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_URL = (process.env.OPENAI_API_URL || 'https://api.openai.com/v1').replace(/\/responses\/?$/, '');
const AI_CACHE_TTL_MS = 1000 * 60 * 2;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 3';

const narrativeCache = new Map<string, { createdAt: number; promise: Promise<AiInterpretation | null> }>();

function buildKey(input: NarrativeInput): string {
  return [
    input.permitNumber,
    input.trade,
    input.address,
    input.permitType,
    input.permitSubtype,
    input.purpose,
    input.valuation,
    input.neighborhood,
    input.contactName,
    input.timeBucket,
    input.likelyTrades.join(',')
  ].join('::');
}

function enabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function extractJson(text: string): AiInterpretation | null {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<AiInterpretation>;
    if (!parsed.summary || typeof parsed.isTradeRelevant !== 'boolean') return null;
    return {
      summary: parsed.summary.trim(),
      whyItMatters: (parsed.whyItMatters || '').trim(),
      tradeReason: (parsed.tradeReason || '').trim(),
      isTradeRelevant: parsed.isTradeRelevant
    };
  } catch {
    return null;
  }
}

export function getAiDebugState() {
  return {
    aiEnabled: enabled(),
    apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    appVersion: APP_VERSION
  };
}

export function clearAiNarrativeCache(key?: string) {
  if (key) {
    narrativeCache.delete(key);
    return;
  }

  narrativeCache.clear();
}

export async function generateAiNarrative(input: NarrativeInput, options?: { bypassCache?: boolean }): Promise<AiInterpretation | null> {
  if (!enabled()) {
    console.log('AI SKIPPED: missing key');
    return null;
  }

  const key = buildKey(input);
  const cached = options?.bypassCache ? null : narrativeCache.get(key);
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
        'You are interpreting commercial permit data for a Nashville subcontractor app.',
        'Return strict JSON with keys: summary, whyItMatters, tradeReason, isTradeRelevant.',
        'summary: the main visible description. One sentence preferred, two short sentences max.',
        'whyItMatters: optional. Only add it if it contributes something new beyond summary. Otherwise use an empty string.',
        'tradeReason: optional. Explain briefly why the selected trade is relevant or not relevant. If no trade is selected or there is nothing useful to add, use an empty string.',
        'isTradeRelevant: true or false based on the selected trade and the permit context.',
        'Write in plainspoken English for a working subcontractor.',
        'Be direct, specific, and human. No hype. No corporate tone. No giant trade lists.',
        'Do not copy messy permit text unless a detail is necessary.',
        'Use the full context to reason about what work is actually happening and what is excluded.',
        'If the permit says no change to exterior, no roofline change, interior only, or similar, exterior trades like roofing should usually be excluded unless the permit clearly says roof or exterior work is happening.',
        'If a permit suggests a trade is excluded, set isTradeRelevant to false and keep tradeReason short.',
        JSON.stringify({
          permitNumber: input.permitNumber,
          address: input.address,
          permitType: input.permitType,
          permitSubtype: input.permitSubtype,
          purpose: input.purpose,
          valuation: input.valuation,
          neighborhood: input.neighborhood,
          contactName: input.contactName,
          timeBucket: input.timeBucket,
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
