import 'server-only';

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

type NarrativeInput = {
  projectId: string;
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

type CacheStatus = 'hit' | 'miss' | 'generating' | 'refreshed' | 'unknown';

type AiCacheEntry = {
  cacheKey: string;
  projectId: string;
  trade: string;
  sourceHash: string;
  storedAt: string;
  updatedAt: string;
  interpretation: AiInterpretation;
};

export type AiDebugResult = {
  attempted: boolean;
  resultSource: 'ai' | 'fallback';
  failureReason: string;
  rawResponseText: string;
  rawResponseShape: string;
  parsed: AiInterpretation | null;
  cacheStatus: CacheStatus;
  cacheKey: string;
  sourceHash: string;
};

const AI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 6000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_URL = (process.env.OPENAI_API_URL || 'https://api.openai.com/v1').replace(/\/responses\/?$/, '');
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 3';
const AI_CACHE_PATH = path.join(process.cwd(), '.cache', 'nbi-ai-cache.json');

let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;
let cacheEntries = new Map<string, AiCacheEntry>();
let cachePersistPromise: Promise<void> = Promise.resolve();
const generationInFlight = new Map<string, Promise<AiDebugResult>>();

let lastAiDebug: AiDebugResult = {
  attempted: false,
  resultSource: 'fallback',
  failureReason: 'not run yet',
  rawResponseText: '',
  rawResponseShape: '',
  parsed: null,
  cacheStatus: 'unknown',
  cacheKey: '',
  sourceHash: ''
};

function normalizeTrade(trade: string): string {
  return trade.trim().toLowerCase() || 'all';
}

function buildSourceHash(input: NarrativeInput): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        permitNumber: input.permitNumber,
        address: input.address,
        permitType: input.permitType,
        permitSubtype: input.permitSubtype,
        purpose: input.purpose,
        valuation: input.valuation,
        neighborhood: input.neighborhood,
        contactName: input.contactName,
        timeBucket: input.timeBucket
      })
    )
    .digest('hex');
}

function buildCacheKey(input: NarrativeInput): string {
  return `${input.projectId}::${normalizeTrade(input.trade)}::${buildSourceHash(input)}`;
}

function enabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function setLastAiDebug(result: AiDebugResult): AiDebugResult {
  lastAiDebug = result;
  return result;
}

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = (async () => {
    try {
      const raw = await readFile(AI_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as AiCacheEntry[];
      cacheEntries = new Map(parsed.map((entry) => [entry.cacheKey, entry]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('AI CACHE LOAD FAILED', error);
      }
      cacheEntries = new Map();
    } finally {
      cacheLoaded = true;
      cacheLoadPromise = null;
    }
  })();

  return cacheLoadPromise;
}

function queueCachePersist(): Promise<void> {
  cachePersistPromise = cachePersistPromise
    .then(async () => {
      await mkdir(path.dirname(AI_CACHE_PATH), { recursive: true });
      await writeFile(AI_CACHE_PATH, JSON.stringify([...cacheEntries.values()], null, 2), 'utf8');
    })
    .catch((error) => {
      console.error('AI CACHE WRITE FAILED', error);
    });

  return cachePersistPromise;
}

function pruneOldEntries(projectId: string, trade: string, nextKey: string) {
  const prefix = `${projectId}::${normalizeTrade(trade)}::`;
  for (const key of cacheEntries.keys()) {
    if (key.startsWith(prefix) && key !== nextKey) {
      cacheEntries.delete(key);
    }
  }
}

function summarizeResponseShape(response: unknown): string {
  if (!response || typeof response !== 'object') return 'invalid response object';

  const data = response as {
    id?: string;
    status?: string;
    error?: unknown;
    incomplete_details?: unknown;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };

  try {
    return JSON.stringify({
      id: data.id || null,
      status: data.status || null,
      error: data.error || null,
      incomplete_details: data.incomplete_details || null,
      output_types: Array.isArray(data.output) ? data.output.map((item) => item?.type || 'unknown') : []
    });
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
    if (!parsed.summary) return { parsed: null, reason: 'missing summary field' };
    if (typeof parsed.isTradeRelevant !== 'boolean') return { parsed: null, reason: 'missing boolean isTradeRelevant field' };

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
    return { parsed: null, reason: `invalid JSON: ${(error as Error).message}` };
  }
}

async function runOpenAiInterpretation(input: NarrativeInput): Promise<AiDebugResult> {
  const cacheKey = buildCacheKey(input);
  const sourceHash = buildSourceHash(input);

  if (!enabled()) {
    console.log('AI SKIPPED: missing key');
    return {
      attempted: false,
      resultSource: 'fallback',
      failureReason: 'missing key',
      rawResponseText: '',
      rawResponseShape: '',
      parsed: null,
      cacheStatus: 'miss',
      cacheKey,
      sourceHash
    };
  }

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
        resultSource: 'fallback',
        failureReason: 'timeout',
        rawResponseText: '',
        rawResponseShape: '',
        parsed: null,
        cacheStatus: 'miss',
        cacheKey,
        sourceHash
      };
    }

    console.log('AI REQUEST SUCCESS');

    const { text, shape } = extractOutputText(response);
    if (!text) {
      console.log('AI EMPTY OUTPUT');
      console.log('AI RESPONSE SHAPE:', shape);
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: 'empty output',
        rawResponseText: '',
        rawResponseShape: shape,
        parsed: null,
        cacheStatus: 'miss',
        cacheKey,
        sourceHash
      };
    }

    const parsed = extractJson(text);
    if (!parsed.parsed) {
      console.log('AI PARSE FAILED:', parsed.reason);
      console.log('AI RESULT:', text);
      console.log('AI RESPONSE SHAPE:', shape);
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: parsed.reason,
        rawResponseText: text,
        rawResponseShape: shape,
        parsed: null,
        cacheStatus: 'miss',
        cacheKey,
        sourceHash
      };
    }

    console.log('AI SUCCESS');
    console.log('AI RESULT:', parsed.parsed);

    return {
      attempted: true,
      resultSource: 'ai',
      failureReason: 'success',
      rawResponseText: text,
      rawResponseShape: shape,
      parsed: parsed.parsed,
      cacheStatus: 'refreshed',
      cacheKey,
      sourceHash
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`AI REQUEST FAILED: ${message}`);
    return {
      attempted: true,
      resultSource: 'fallback',
      failureReason: `request failed: ${message}`,
      rawResponseText: '',
      rawResponseShape: '',
      parsed: null,
      cacheStatus: 'miss',
      cacheKey,
      sourceHash
    };
  }
}

async function storeAiInterpretation(input: NarrativeInput, interpretation: AiInterpretation): Promise<void> {
  await ensureCacheLoaded();
  const cacheKey = buildCacheKey(input);
  pruneOldEntries(input.projectId, input.trade, cacheKey);
  cacheEntries.set(cacheKey, {
    cacheKey,
    projectId: input.projectId,
    trade: normalizeTrade(input.trade),
    sourceHash: buildSourceHash(input),
    storedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    interpretation
  });
  await queueCachePersist();
}

export function getAiDebugState() {
  return {
    aiEnabled: enabled(),
    apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    appVersion: APP_VERSION,
    lastAiCallAttempted: lastAiDebug.attempted,
    lastAiResultSource: lastAiDebug.resultSource,
    lastAiFailureReason: lastAiDebug.failureReason,
    lastCacheStatus: lastAiDebug.cacheStatus
  };
}

export function getLastAiDebugResult(): AiDebugResult {
  return lastAiDebug;
}

export async function getCachedAiInterpretation(input: NarrativeInput): Promise<{ interpretation: AiInterpretation | null; cacheStatus: CacheStatus; cacheKey: string; sourceHash: string }> {
  await ensureCacheLoaded();
  const cacheKey = buildCacheKey(input);
  const sourceHash = buildSourceHash(input);
  const entry = cacheEntries.get(cacheKey);
  if (!entry) {
    return { interpretation: null, cacheStatus: generationInFlight.has(cacheKey) ? 'generating' : 'miss', cacheKey, sourceHash };
  }

  return { interpretation: entry.interpretation, cacheStatus: 'hit', cacheKey, sourceHash };
}

export async function generateAndStoreAiInterpretation(input: NarrativeInput, options?: { bypassCache?: boolean }): Promise<AiDebugResult> {
  await ensureCacheLoaded();
  const cacheKey = buildCacheKey(input);
  const sourceHash = buildSourceHash(input);

  if (!options?.bypassCache) {
    const cached = cacheEntries.get(cacheKey);
    if (cached) {
      console.log('AI CACHE HIT');
      return setLastAiDebug({
        attempted: false,
        resultSource: 'ai',
        failureReason: 'cache hit',
        rawResponseText: '',
        rawResponseShape: '',
        parsed: cached.interpretation,
        cacheStatus: 'hit',
        cacheKey,
        sourceHash
      });
    }
  }

  const inflight = generationInFlight.get(cacheKey);
  if (inflight && !options?.bypassCache) {
    return setLastAiDebug({
      attempted: false,
      resultSource: 'fallback',
      failureReason: 'generating',
      rawResponseText: '',
      rawResponseShape: '',
      parsed: null,
      cacheStatus: 'generating',
      cacheKey,
      sourceHash
    });
  }

  const promise = runOpenAiInterpretation(input).then(async (result) => {
    if (result.parsed) {
      await storeAiInterpretation(input, result.parsed);
    }
    return result;
  });

  generationInFlight.set(cacheKey, promise);

  try {
    const result = await promise;
    return setLastAiDebug(result);
  } finally {
    generationInFlight.delete(cacheKey);
  }
}

export async function queueAiInterpretation(input: NarrativeInput): Promise<{ cacheStatus: CacheStatus; cacheKey: string; sourceHash: string }> {
  await ensureCacheLoaded();
  const cacheKey = buildCacheKey(input);
  const sourceHash = buildSourceHash(input);

  if (cacheEntries.has(cacheKey)) {
    setLastAiDebug({
      attempted: false,
      resultSource: 'ai',
      failureReason: 'cache hit',
      rawResponseText: '',
      rawResponseShape: '',
      parsed: cacheEntries.get(cacheKey)?.interpretation || null,
      cacheStatus: 'hit',
      cacheKey,
      sourceHash
    });
    return { cacheStatus: 'hit', cacheKey, sourceHash };
  }

  if (generationInFlight.has(cacheKey)) {
    setLastAiDebug({
      attempted: false,
      resultSource: 'fallback',
      failureReason: 'generating',
      rawResponseText: '',
      rawResponseShape: '',
      parsed: null,
      cacheStatus: 'generating',
      cacheKey,
      sourceHash
    });
    return { cacheStatus: 'generating', cacheKey, sourceHash };
  }

  const promise = runOpenAiInterpretation(input)
    .then(async (result) => {
      if (result.parsed) {
        await storeAiInterpretation(input, result.parsed);
        setLastAiDebug(result);
      } else {
        setLastAiDebug(result);
      }
      return result;
    })
    .finally(() => {
      generationInFlight.delete(cacheKey);
    });

  generationInFlight.set(cacheKey, promise);
  setLastAiDebug({
    attempted: false,
    resultSource: 'fallback',
    failureReason: 'queued for background generation',
    rawResponseText: '',
    rawResponseShape: '',
    parsed: null,
    cacheStatus: 'generating',
    cacheKey,
    sourceHash
  });
  void promise;

  return { cacheStatus: 'generating', cacheKey, sourceHash };
}

export async function clearAiNarrativeCache(key?: string) {
  await ensureCacheLoaded();

  if (key) {
    cacheEntries.delete(key);
  } else {
    cacheEntries.clear();
  }

  await queueCachePersist();
}
