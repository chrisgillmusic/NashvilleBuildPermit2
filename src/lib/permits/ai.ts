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

export type AiDebugResult = {
  attempted: boolean;
  resultSource: 'ai' | 'fallback';
  failureReason: string;
  rawResponseText: string;
  rawResponseShape: string;
  parsed: AiInterpretation | null;
};

const AI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 6000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_URL = (process.env.OPENAI_API_URL || 'https://api.openai.com/v1').replace(/\/responses\/?$/, '');
const AI_CACHE_TTL_MS = 1000 * 60 * 2;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 3';

const narrativeCache = new Map<string, { createdAt: number; promise: Promise<AiDebugResult> }>();

let lastAiDebug: AiDebugResult = {
  attempted: false,
  resultSource: 'fallback',
  failureReason: 'not run yet',
  rawResponseText: '',
  rawResponseShape: '',
  parsed: null
};

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

function setLastAiDebug(result: AiDebugResult): AiDebugResult {
  lastAiDebug = result;
  return result;
}

function summarizeResponseShape(response: unknown): string {
  if (!response || typeof response !== 'object') return 'no response object';

  const data = response as {
    id?: string;
    status?: string;
    error?: unknown;
    incomplete_details?: unknown;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };

  const summary = {
    id: data.id || null,
    status: data.status || null,
    error: data.error || null,
    incomplete_details: data.incomplete_details || null,
    output_types: Array.isArray(data.output) ? data.output.map((item) => item?.type || 'unknown') : []
  };

  try {
    return JSON.stringify(summary);
  } catch {
    return 'unserializable response shape';
  }
}

function extractOutputText(response: unknown): { text: string; shape: string } {
  if (!response || typeof response !== 'object') {
    return { text: '', shape: 'invalid response object' };
  }

  const data = response as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return { text: data.output_text.trim(), shape: summarizeResponseShape(response) };
  }

  const chunks: string[] = [];
  for (const item of data.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  return { text: chunks.join('\n').trim(), shape: summarizeResponseShape(response) };
}

function extractJson(text: string): { parsed: AiInterpretation | null; reason: string } {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<AiInterpretation>;
    if (!parsed.summary) {
      return { parsed: null, reason: 'missing summary field' };
    }
    if (typeof parsed.isTradeRelevant !== 'boolean') {
      return { parsed: null, reason: 'missing boolean isTradeRelevant field' };
    }

    return {
      parsed: {
        summary: parsed.summary.trim(),
        whyItMatters: (parsed.whyItMatters || '').trim(),
        tradeReason: (parsed.tradeReason || '').trim(),
        isTradeRelevant: parsed.isTradeRelevant
      },
      reason: 'success'
    };
  } catch (error) {
    return {
      parsed: null,
      reason: `invalid JSON: ${(error as Error).message}`
    };
  }
}

export function getAiDebugState() {
  return {
    aiEnabled: enabled(),
    apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    appVersion: APP_VERSION,
    lastAiCallAttempted: lastAiDebug.attempted,
    lastAiResultSource: lastAiDebug.resultSource,
    lastAiFailureReason: lastAiDebug.failureReason
  };
}

export function clearAiNarrativeCache(key?: string) {
  if (key) {
    narrativeCache.delete(key);
    return;
  }

  narrativeCache.clear();
}

export function getLastAiDebugResult(): AiDebugResult {
  return lastAiDebug;
}

export async function generateAiNarrativeDetailed(input: NarrativeInput, options?: { bypassCache?: boolean }): Promise<AiDebugResult> {
  if (!enabled()) {
    console.log('AI SKIPPED: missing key');
    return setLastAiDebug({
      attempted: false,
      resultSource: 'fallback',
      failureReason: 'missing key',
      rawResponseText: '',
      rawResponseShape: '',
      parsed: null
    });
  }

  const key = buildKey(input);
  if (!options?.bypassCache) {
    const cached = narrativeCache.get(key);
    if (cached && Date.now() - cached.createdAt < AI_CACHE_TTL_MS) {
      console.log('AI CACHE HIT');
      const cachedResult = await cached.promise;
      return setLastAiDebug({
        ...cachedResult,
        attempted: false,
        failureReason: 'cache hit'
      });
    }
  }

  const promise: Promise<AiDebugResult> = (async () => {
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
      console.log('AI REQUEST START');

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
        return {
          attempted: true,
          resultSource: 'fallback' as const,
          failureReason: 'timeout',
          rawResponseText: '',
          rawResponseShape: '',
          parsed: null
        };
      }

      console.log('AI REQUEST SUCCESS');

      const { text, shape } = extractOutputText(response);
      if (!text) {
        console.log('AI EMPTY OUTPUT');
        console.log('AI RESPONSE SHAPE:', shape);
        return {
          attempted: true,
          resultSource: 'fallback' as const,
          failureReason: 'empty output',
          rawResponseText: '',
          rawResponseShape: shape,
          parsed: null
        };
      }

      const parsed = extractJson(text);
      if (!parsed.parsed) {
        console.log('AI PARSE FAILED:', parsed.reason);
        console.log('AI RESULT:', text);
        console.log('AI RESPONSE SHAPE:', shape);
        return {
          attempted: true,
          resultSource: 'fallback' as const,
          failureReason: parsed.reason,
          rawResponseText: text,
          rawResponseShape: shape,
          parsed: null
        };
      }

      console.log('AI SUCCESS');
      console.log('AI RESULT:', parsed.parsed);

      return {
        attempted: true,
        resultSource: 'ai' as const,
        failureReason: 'success',
        rawResponseText: text,
        rawResponseShape: shape,
        parsed: parsed.parsed
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`AI REQUEST FAILED: ${message}`);
      return {
        attempted: true,
        resultSource: 'fallback' as const,
        failureReason: `request failed: ${message}`,
        rawResponseText: '',
        rawResponseShape: '',
        parsed: null
      };
    }
  })();

  narrativeCache.set(key, { createdAt: Date.now(), promise });
  const result = await promise;
  return setLastAiDebug(result);
}

export async function generateAiNarrative(input: NarrativeInput, options?: { bypassCache?: boolean }): Promise<AiInterpretation | null> {
  const result = await generateAiNarrativeDetailed(input, options);
  return result.parsed;
}
