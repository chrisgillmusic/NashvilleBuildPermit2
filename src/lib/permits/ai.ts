import 'server-only';

import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { InterpretationSource } from './types';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 5 • AI Pipeline';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AI_TIMEOUT_MS = 12_000;
const STORAGE_PREFIX = 'ai_interpretation:v1:';

export type NarrativeInput = {
  projectId: string;
  permitNumber: string;
  address: string;
  permitType: string;
  permitSubtype: string;
  purpose: string;
  valuation: number;
  neighborhood: string;
  contactName: string;
  timeBucket: string;
  trade: string;
  likelyTrades: string[];
};

export type AiNarrative = {
  summary: string;
  whyItMatters: string;
  tradeReason: string;
  isTradeRelevant: boolean;
};

export type StoredAiInterpretation = {
  projectId: string;
  trade: string;
  sourceHash: string;
  cacheKey: string;
  source: 'ai';
  generatedAt: string;
  version: string;
  interpretation: AiNarrative;
};

export type StoredAiLookup = {
  cacheKey: string;
  cacheStatus: 'hit' | 'miss';
  interpretation: StoredAiInterpretation | null;
};

export type AiDebugResult = {
  attempted: boolean;
  resultSource: InterpretationSource;
  failureReason: string;
  rawResponseText: string;
  rawResponseShape: string;
  cacheStatus: string;
  parsed: AiNarrative | null;
  stored: boolean;
};

type StoredValueShape = {
  projectId: string;
  trade: string;
  sourceHash: string;
  generatedAt: string;
  version: string;
  source: 'ai';
  interpretation: AiNarrative;
};

type AiDebugState = {
  aiEnabled: boolean;
  apiKeyPresent: boolean;
  appVersion: string;
  lastAiCallAttempted: boolean;
  lastAiResultSource: InterpretationSource | 'unknown';
  lastAiFailureReason: string;
  lastCacheStatus: string;
};

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const memoryCache = new Map<string, StoredAiInterpretation>();
const inFlight = new Map<string, Promise<AiDebugResult>>();

let debugState: AiDebugState = {
  aiEnabled: Boolean(client),
  apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
  appVersion: APP_VERSION,
  lastAiCallAttempted: false,
  lastAiResultSource: 'unknown',
  lastAiFailureReason: 'idle',
  lastCacheStatus: 'miss'
};

function setDebugState(update: Partial<AiDebugState>) {
  debugState = { ...debugState, ...update };
}

function normalizeTrade(value: string): string {
  return value.trim().toLowerCase();
}

function tradeToken(value: string): string {
  const normalized = normalizeTrade(value);
  if (!normalized) return 'all';
  return normalized.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
}

function shapeFromResponse(response: unknown): string {
  if (!response || typeof response !== 'object') return typeof response;

  const maybeResponse = response as {
    output_text?: unknown;
    output?: Array<{ type?: string; content?: Array<{ type?: string }> }>;
  };

  return JSON.stringify({
    hasOutputText: typeof maybeResponse.output_text === 'string' && maybeResponse.output_text.length > 0,
    outputItems:
      maybeResponse.output?.map((item) => ({
        type: item.type || 'unknown',
        contentTypes: item.content?.map((content) => content.type || 'unknown') || []
      })) || []
  });
}

function extractResponseText(response: unknown): { text: string; shape: string } {
  const shape = shapeFromResponse(response);
  const maybeResponse = response as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof maybeResponse?.output_text === 'string' && maybeResponse.output_text.trim()) {
    return { text: maybeResponse.output_text.trim(), shape };
  }

  const chunks: string[] = [];
  for (const item of maybeResponse?.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  return { text: chunks.join('\n').trim(), shape };
}

function maybeExtractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

function normalizeNarrativeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function textsOverlap(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/[^\w]+/g, ' ').trim();
  const b = right.toLowerCase().replace(/[^\w]+/g, ' ').trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function parseAiNarrative(text: string): { parsed: AiNarrative | null; failureReason: string } {
  const json = maybeExtractJsonBlock(text);
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(json);
  } catch (error) {
    return { parsed: null, failureReason: `invalid JSON: ${(error as Error).message}` };
  }

  const summary = normalizeNarrativeText((parsedValue as Record<string, unknown>)?.summary);
  const whyItMatters = normalizeNarrativeText((parsedValue as Record<string, unknown>)?.whyItMatters);
  const tradeReason = normalizeNarrativeText((parsedValue as Record<string, unknown>)?.tradeReason);
  const isTradeRelevant = (parsedValue as Record<string, unknown>)?.isTradeRelevant;

  if (!summary) {
    return { parsed: null, failureReason: 'missing summary field' };
  }

  if (typeof isTradeRelevant !== 'boolean') {
    return { parsed: null, failureReason: 'missing boolean isTradeRelevant field' };
  }

  return {
    parsed: {
      summary,
      whyItMatters: whyItMatters && !textsOverlap(whyItMatters, summary) ? whyItMatters : '',
      tradeReason:
        tradeReason && !textsOverlap(tradeReason, summary) && !textsOverlap(tradeReason, whyItMatters) ? tradeReason : '',
      isTradeRelevant
    },
    failureReason: 'success'
  };
}

function buildPrompt(input: NarrativeInput): string {
  return [
    'You are helping commercial subcontractors quickly understand a Nashville building permit.',
    'Return strict JSON only with these fields: summary, whyItMatters, tradeReason, isTradeRelevant.',
    'Rules:',
    '- summary: 1 sentence preferred, 2 short sentences max, plainspoken and specific.',
    '- whyItMatters: optional. Use an empty string if it does not add new information.',
    '- tradeReason: optional. Use an empty string if the selected trade is not a real fit or if the note would be vague.',
    '- isTradeRelevant: boolean based on the actual scope, not optimism.',
    '- Do not copy permit sludge or metadata directly unless necessary.',
    '- Do not imply roofing or exterior work when the permit says no exterior work, no roofline change, or interior-only scope.',
    '- If the selected trade is not actually implicated, set isTradeRelevant to false and leave tradeReason empty.',
    '',
    `Selected trade: ${input.trade || 'None selected'}`,
    `Address: ${input.address || 'Unknown'}`,
    `Permit number: ${input.permitNumber || 'Unknown'}`,
    `Permit type: ${input.permitType || 'Unknown'}`,
    `Permit subtype: ${input.permitSubtype || 'Unknown'}`,
    `Neighborhood: ${input.neighborhood || 'Unknown'}`,
    `Valuation: ${input.valuation ? `$${Math.round(input.valuation).toLocaleString('en-US')}` : 'Unknown'}`,
    `Time bucket: ${input.timeBucket}`,
    `Listed contact: ${input.contactName || 'Unknown'}`,
    `Fallback trade hints: ${input.likelyTrades.join(', ') || 'None'}`,
    `Permit description: ${input.purpose || 'No description available'}`,
    '',
    'Return JSON only.'
  ].join('\n');
}

export function buildSourceHash(input: NarrativeInput): string {
  const serialized = JSON.stringify({
    projectId: input.projectId,
    permitNumber: input.permitNumber,
    address: input.address,
    permitType: input.permitType,
    permitSubtype: input.permitSubtype,
    purpose: input.purpose,
    valuation: input.valuation,
    neighborhood: input.neighborhood,
    contactName: input.contactName,
    timeBucket: input.timeBucket
  });

  return createHash('sha1').update(serialized).digest('hex');
}

export function buildCacheKey(input: NarrativeInput): string {
  return `${input.projectId}:${tradeToken(input.trade)}:${buildSourceHash(input)}`;
}

function storageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${cacheKey}`;
}

function toStoredInterpretation(input: NarrativeInput, narrative: AiNarrative): StoredAiInterpretation {
  const sourceHash = buildSourceHash(input);
  const cacheKey = buildCacheKey(input);
  return {
    projectId: input.projectId,
    trade: normalizeTrade(input.trade),
    sourceHash,
    cacheKey,
    source: 'ai',
    generatedAt: new Date().toISOString(),
    version: APP_VERSION,
    interpretation: narrative
  };
}

function isStoredValueShape(value: unknown): value is StoredValueShape {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const interpretation = record.interpretation as Record<string, unknown> | undefined;

  return (
    typeof record.projectId === 'string' &&
    typeof record.trade === 'string' &&
    typeof record.sourceHash === 'string' &&
    typeof record.generatedAt === 'string' &&
    typeof record.version === 'string' &&
    record.source === 'ai' &&
    Boolean(interpretation) &&
    typeof interpretation?.summary === 'string' &&
    typeof interpretation?.whyItMatters === 'string' &&
    typeof interpretation?.tradeReason === 'string' &&
    typeof interpretation?.isTradeRelevant === 'boolean'
  );
}

function parseStoredRecord(key: string, value: unknown): StoredAiInterpretation | null {
  if (!isStoredValueShape(value)) return null;

  return {
    ...value,
    cacheKey: key
  };
}

async function storeInterpretation(record: StoredAiInterpretation): Promise<boolean> {
  memoryCache.set(record.cacheKey, record);

  try {
    await prisma.appSetting.upsert({
      where: { key: storageKey(record.cacheKey) },
      update: {
        value: {
          projectId: record.projectId,
          trade: record.trade,
          sourceHash: record.sourceHash,
          generatedAt: record.generatedAt,
          version: record.version,
          source: record.source,
          interpretation: record.interpretation
        }
      },
      create: {
        key: storageKey(record.cacheKey),
        value: {
          projectId: record.projectId,
          trade: record.trade,
          sourceHash: record.sourceHash,
          generatedAt: record.generatedAt,
          version: record.version,
          source: record.source,
          interpretation: record.interpretation
        }
      }
    });

    return true;
  } catch (error) {
    console.error('AI STORAGE FAILED:', (error as Error).message);
    return false;
  }
}

export function getAiDebugState() {
  return { ...debugState };
}

export async function getStoredAiInterpretation(input: NarrativeInput): Promise<StoredAiLookup> {
  const cacheKey = buildCacheKey(input);
  const hot = memoryCache.get(cacheKey);

  if (hot) {
    setDebugState({ lastCacheStatus: 'hit' });
    return {
      cacheKey,
      cacheStatus: 'hit',
      interpretation: hot
    };
  }

  try {
    const row = await prisma.appSetting.findUnique({ where: { key: storageKey(cacheKey) } });
    if (!row) {
      setDebugState({ lastCacheStatus: 'miss' });
      return { cacheKey, cacheStatus: 'miss', interpretation: null };
    }

    const parsed = parseStoredRecord(cacheKey, row.value);
    if (!parsed) {
      setDebugState({ lastCacheStatus: 'miss' });
      return { cacheKey, cacheStatus: 'miss', interpretation: null };
    }

    memoryCache.set(cacheKey, parsed);
    setDebugState({ lastCacheStatus: 'hit' });
    return { cacheKey, cacheStatus: 'hit', interpretation: parsed };
  } catch (error) {
    console.error('AI STORAGE READ FAILED:', (error as Error).message);
    setDebugState({ lastCacheStatus: 'miss' });
    return { cacheKey, cacheStatus: 'miss', interpretation: null };
  }
}

export async function getStoredAiInterpretations(inputs: NarrativeInput[]): Promise<Map<string, StoredAiLookup>> {
  const lookups = new Map<string, StoredAiLookup>();
  const misses: Array<{ input: NarrativeInput; cacheKey: string }> = [];

  for (const input of inputs) {
    const cacheKey = buildCacheKey(input);
    const hot = memoryCache.get(cacheKey);

    if (hot) {
      lookups.set(input.projectId, { cacheKey, cacheStatus: 'hit', interpretation: hot });
      continue;
    }

    misses.push({ input, cacheKey });
  }

  if (misses.length) {
    try {
      const rows = await prisma.appSetting.findMany({
        where: {
          key: {
            in: misses.map((entry) => storageKey(entry.cacheKey))
          }
        }
      });

      const byKey = new Map(rows.map((row) => [row.key, row.value]));

      for (const miss of misses) {
        const parsed = parseStoredRecord(miss.cacheKey, byKey.get(storageKey(miss.cacheKey)));
        if (parsed) {
          memoryCache.set(miss.cacheKey, parsed);
          lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'hit', interpretation: parsed });
        } else {
          lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'miss', interpretation: null });
        }
      }
    } catch (error) {
      console.error('AI STORAGE BATCH READ FAILED:', (error as Error).message);
      for (const miss of misses) {
        lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'miss', interpretation: null });
      }
    }
  }

  setDebugState({ lastCacheStatus: lookups.size && [...lookups.values()].some((entry) => entry.cacheStatus === 'hit') ? 'hit' : 'miss' });
  return lookups;
}

export async function generateAndStoreAiInterpretation(
  input: NarrativeInput,
  options?: { bypassCache?: boolean }
): Promise<AiDebugResult> {
  const cacheKey = buildCacheKey(input);

  if (!client) {
    console.log('AI SKIPPED: missing key');
    setDebugState({
      lastAiCallAttempted: false,
      lastAiResultSource: 'fallback',
      lastAiFailureReason: 'missing key',
      lastCacheStatus: 'miss'
    });
    return {
      attempted: false,
      resultSource: 'fallback',
      failureReason: 'missing key',
      rawResponseText: '',
      rawResponseShape: '',
      cacheStatus: 'miss',
      parsed: null,
      stored: false
    };
  }

  if (!options?.bypassCache) {
    const cached = await getStoredAiInterpretation(input);
    if (cached.interpretation) {
      console.log('AI CACHE HIT');
      setDebugState({
        lastAiCallAttempted: false,
        lastAiResultSource: 'ai',
        lastAiFailureReason: 'cache hit',
        lastCacheStatus: 'hit'
      });
      return {
        attempted: false,
        resultSource: 'ai',
        failureReason: 'cache hit',
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'hit',
        parsed: cached.interpretation.interpretation,
        stored: true
      };
    }
  }

  const existing = inFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<AiDebugResult> => {
    console.log('AI CALLED');
    console.log('AI REQUEST START');
    setDebugState({
      lastAiCallAttempted: true,
      lastAiResultSource: 'fallback',
      lastAiFailureReason: 'in progress',
      lastCacheStatus: options?.bypassCache ? 'refreshing' : 'miss'
    });

    const timeoutSignal = AbortSignal.timeout(AI_TIMEOUT_MS);

    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: buildPrompt(input)
      }, {
        signal: timeoutSignal
      });

      console.log('AI REQUEST SUCCESS');
      const { text, shape } = extractResponseText(response);

      if (!text) {
        console.log('AI EMPTY OUTPUT');
        setDebugState({
          lastAiResultSource: 'fallback',
          lastAiFailureReason: 'empty output',
          lastCacheStatus: 'miss'
        });
        return {
          attempted: true,
          resultSource: 'fallback',
          failureReason: 'empty output',
          rawResponseText: '',
          rawResponseShape: shape,
          cacheStatus: 'miss',
          parsed: null,
          stored: false
        };
      }

      const parsedResult = parseAiNarrative(text);
      if (!parsedResult.parsed) {
        console.log('AI PARSE FAILED:', parsedResult.failureReason);
        setDebugState({
          lastAiResultSource: 'fallback',
          lastAiFailureReason: parsedResult.failureReason,
          lastCacheStatus: 'miss'
        });
        return {
          attempted: true,
          resultSource: 'fallback',
          failureReason: parsedResult.failureReason,
          rawResponseText: text,
          rawResponseShape: shape,
          cacheStatus: 'miss',
          parsed: null,
          stored: false
        };
      }

      console.log('AI SUCCESS');
      console.log('AI RESULT:', parsedResult.parsed);
      const record = toStoredInterpretation(input, parsedResult.parsed);
      const stored = await storeInterpretation(record);
      setDebugState({
        lastAiResultSource: 'ai',
        lastAiFailureReason: 'success',
        lastCacheStatus: stored ? options?.bypassCache ? 'refreshed' : 'stored' : 'stored-in-memory'
      });

      return {
        attempted: true,
        resultSource: 'ai',
        failureReason: 'success',
        rawResponseText: text,
        rawResponseShape: shape,
        cacheStatus: stored ? options?.bypassCache ? 'refreshed' : 'stored' : 'stored-in-memory',
        parsed: parsedResult.parsed,
        stored
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('aborted')) {
        console.log('AI SKIPPED: timeout');
        setDebugState({
          lastAiResultSource: 'fallback',
          lastAiFailureReason: 'timeout',
          lastCacheStatus: 'miss'
        });
        return {
          attempted: true,
          resultSource: 'fallback',
          failureReason: 'timeout',
          rawResponseText: '',
          rawResponseShape: '',
          cacheStatus: 'miss',
          parsed: null,
          stored: false
        };
      }

      console.log(`AI REQUEST FAILED: ${message}`);
      setDebugState({
        lastAiResultSource: 'fallback',
        lastAiFailureReason: `request failed: ${message}`,
        lastCacheStatus: 'miss'
      });
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: `request failed: ${message}`,
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'miss',
        parsed: null,
        stored: false
      };
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
}

export async function generateAndStoreAiInterpretations(
  inputs: NarrativeInput[],
  options?: { bypassCache?: boolean; concurrency?: number }
) {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, 4));
  const results: Array<{
    id: string;
    summarySource: InterpretationSource;
    tradeSource: InterpretationSource;
    cacheStatus: string;
    failureReason: string;
    stored: boolean;
  }> = new Array(inputs.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < inputs.length) {
      const current = cursor;
      cursor += 1;
      const input = inputs[current];
      const result = await generateAndStoreAiInterpretation(input, options);
      results[current] = {
        id: input.projectId,
        summarySource: result.resultSource,
        tradeSource: input.trade ? result.resultSource : 'fallback',
        cacheStatus: result.cacheStatus,
        failureReason: result.failureReason,
        stored: result.stored
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length || 1) }, () => run()));
  return results;
}

export function clearAiNarrativeCache(key?: string) {
  if (key) {
    memoryCache.delete(key);
    return;
  }

  memoryCache.clear();
}
