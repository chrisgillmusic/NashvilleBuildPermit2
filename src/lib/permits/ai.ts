import 'server-only';

import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { InterpretationSource } from './types';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 13 • Summary First';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AI_TIMEOUT_MS = 20_000;
const SUMMARY_STORAGE_PREFIX = 'summary_engine:v1:base:';
const TRADE_NOTE_STORAGE_PREFIX = 'summary_engine:v1:trade:';

export type BaseSummaryInput = {
  projectId: string;
  permitType: string;
  permitSubtype: string;
  purpose: string;
  valuation: number;
  location: string;
};

export type TradeNoteInput = {
  projectId: string;
  permitType: string;
  permitSubtype: string;
  purpose: string;
  selectedTrade: string;
  baseSummary: string;
};

export type StoredBaseSummary = {
  projectId: string;
  sourceHash: string;
  cacheKey: string;
  source: 'ai';
  generatedAt: string;
  version: string;
  summary: string;
};

export type StoredTradeNote = {
  projectId: string;
  trade: string;
  sourceHash: string;
  cacheKey: string;
  source: 'ai';
  generatedAt: string;
  version: string;
  tradeNote: string;
  isTradeRelevant: boolean;
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

export type SummaryLookup = {
  cacheKey: string;
  cacheStatus: 'hit' | 'miss';
  summary: StoredBaseSummary | null;
};

export type TradeNoteLookup = {
  cacheKey: string;
  cacheStatus: 'hit' | 'miss';
  tradeNote: StoredTradeNote | null;
};

export type BaseSummaryDebugResult = {
  attempted: boolean;
  resultSource: InterpretationSource;
  failureReason: string;
  rawResponseText: string;
  rawResponseShape: string;
  cacheStatus: string;
  parsedSummary: string;
  stored: boolean;
  requestDurationMs: number;
  openaiErrorMessage: string;
  openaiErrorName: string;
  openaiStatusCode: number | null;
  apiKeyDetected: boolean;
  clientInitialized: boolean;
};

export type DbWriteDebugResult = {
  stored: boolean;
  errorMessage: string;
  errorName: string;
  errorCode: string;
};

export type TradeNoteDebugResult = {
  attempted: boolean;
  resultSource: InterpretationSource;
  failureReason: string;
  rawResponseText: string;
  rawResponseShape: string;
  cacheStatus: string;
  parsedTradeNote: string;
  parsedIsTradeRelevant: boolean | null;
  stored: boolean;
};

export type TruthStageResult = {
  stage:
    | 'fetch_permit'
    | 'build_prompt'
    | 'openai_request'
    | 'openai_response'
    | 'parse_response'
    | 'save_db'
    | 'read_back_db'
    | 'ui_source_check'
    | 'complete';
  success: boolean;
  durationMs: number;
  error?: string;
  preview?: string;
};

type StoredBaseSummaryShape = Omit<StoredBaseSummary, 'cacheKey'>;
type StoredTradeNoteShape = Omit<StoredTradeNote, 'cacheKey'>;

const summaryMemoryCache = new Map<string, StoredBaseSummary>();
const tradeNoteMemoryCache = new Map<string, StoredTradeNote>();
const inFlight = new Map<string, Promise<BaseSummaryDebugResult | TradeNoteDebugResult>>();

let debugState: AiDebugState = {
  aiEnabled: Boolean(process.env.OPENAI_API_KEY),
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

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || '';
  if (!apiKey) {
    return {
      apiKeyDetected: false,
      clientInitialized: false,
      client: null as OpenAI | null
    };
  }

  try {
    return {
      apiKeyDetected: true,
      clientInitialized: true,
      client: new OpenAI({ apiKey })
    };
  } catch {
    return {
      apiKeyDetected: true,
      clientInitialized: false,
      client: null as OpenAI | null
    };
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
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

function buildBaseSummaryPrompt(input: BaseSummaryInput): string {
  return [
    'Summarize this construction permit for a subcontractor in one short sentence.',
    '',
    `Permit type: ${input.permitType || 'Unknown'}`,
    `Permit subtype: ${input.permitSubtype || 'Unknown'}`,
    `Description: ${input.purpose || 'No description available'}`
  ].join('\n');
}

const SUMMARY_JSON_SCHEMA = {
  type: 'json_schema' as const,
  name: 'permit_summary',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' }
    },
    required: ['summary'],
    additionalProperties: false
  }
};

function buildTradeNotePrompt(input: TradeNoteInput): string {
  return [
    'Evaluate whether this permit is relevant to one selected subcontractor trade.',
    'Return strict JSON only with keys: isTradeRelevant, tradeNote.',
    'Rules:',
    '- tradeNote must be one short sentence max.',
    '- If the trade is not a real fit, set isTradeRelevant to false and tradeNote to an empty string.',
    '- Be conservative.',
    '- Do not imply exterior or roofing work if the permit says interior only, no exterior work, or no roofline change.',
    '',
    `Project ID: ${input.projectId}`,
    `Selected trade: ${input.selectedTrade}`,
    `Permit type: ${input.permitType || 'Unknown'}`,
    `Permit subtype: ${input.permitSubtype || 'Unknown'}`,
    `Base summary: ${input.baseSummary || 'Unknown'}`,
    `Description: ${input.purpose || 'No description available'}`
  ].join('\n');
}

export function buildBaseSourceHash(input: BaseSummaryInput): string {
  const serialized = JSON.stringify({
    permitType: input.permitType,
    permitSubtype: input.permitSubtype,
    purpose: input.purpose,
    valuation: input.valuation,
    location: input.location
  });

  return createHash('sha1').update(serialized).digest('hex');
}

export function buildTradeSourceHash(input: TradeNoteInput): string {
  const serialized = JSON.stringify({
    permitType: input.permitType,
    permitSubtype: input.permitSubtype,
    purpose: input.purpose,
    selectedTrade: normalizeTrade(input.selectedTrade),
    baseSummary: input.baseSummary
  });

  return createHash('sha1').update(serialized).digest('hex');
}

function buildBaseCacheKey(input: BaseSummaryInput): string {
  return `${input.projectId}:${buildBaseSourceHash(input)}`;
}

function buildTradeCacheKey(input: TradeNoteInput): string {
  return `${input.projectId}:${tradeToken(input.selectedTrade)}:${buildTradeSourceHash(input)}`;
}

function summaryStorageKey(cacheKey: string): string {
  return `${SUMMARY_STORAGE_PREFIX}${cacheKey}`;
}

function tradeStorageKey(cacheKey: string): string {
  return `${TRADE_NOTE_STORAGE_PREFIX}${cacheKey}`;
}

export function getBaseSummaryStorageInfo(input: BaseSummaryInput) {
  const cacheKey = buildBaseCacheKey(input);
  return {
    cacheKey,
    storageKey: summaryStorageKey(cacheKey),
    sourceHash: buildBaseSourceHash(input)
  };
}

function isStoredBaseSummaryShape(value: unknown): value is StoredBaseSummaryShape {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectId === 'string' &&
    typeof record.sourceHash === 'string' &&
    typeof record.generatedAt === 'string' &&
    typeof record.version === 'string' &&
    record.source === 'ai' &&
    typeof record.summary === 'string'
  );
}

function isStoredTradeNoteShape(value: unknown): value is StoredTradeNoteShape {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectId === 'string' &&
    typeof record.trade === 'string' &&
    typeof record.sourceHash === 'string' &&
    typeof record.generatedAt === 'string' &&
    typeof record.version === 'string' &&
    record.source === 'ai' &&
    typeof record.tradeNote === 'string' &&
    typeof record.isTradeRelevant === 'boolean'
  );
}

function parseStoredBaseSummary(cacheKey: string, value: unknown): StoredBaseSummary | null {
  if (!isStoredBaseSummaryShape(value)) return null;
  return { ...value, cacheKey };
}

function parseStoredTradeNote(cacheKey: string, value: unknown): StoredTradeNote | null {
  if (!isStoredTradeNoteShape(value)) return null;
  return { ...value, cacheKey };
}

function normalizeSummaryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/^[\-\u2022]\s*/, '').replace(/^summary:\s*/i, '');
}

function parseSimpleSummaryJson(text: string): { summary: string; failureReason: string } {
  const json = maybeExtractJsonBlock(text);
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(json);
  } catch (error) {
    return { summary: '', failureReason: `invalid JSON: ${(error as Error).message}` };
  }

  const summary = normalizeSummaryText(normalizeText((parsedValue as Record<string, unknown>)?.summary));
  if (!summary) {
    return { summary: '', failureReason: 'missing summary field' };
  }

  return { summary, failureReason: 'success' };
}

function parseTradeNote(text: string): { tradeNote: string; isTradeRelevant: boolean | null; failureReason: string } {
  const json = maybeExtractJsonBlock(text);
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(json);
  } catch (error) {
    return { tradeNote: '', isTradeRelevant: null, failureReason: `invalid JSON: ${(error as Error).message}` };
  }

  const tradeNote = normalizeText((parsedValue as Record<string, unknown>)?.tradeNote);
  const isTradeRelevant = (parsedValue as Record<string, unknown>)?.isTradeRelevant;
  if (typeof isTradeRelevant !== 'boolean') {
    return { tradeNote: '', isTradeRelevant: null, failureReason: 'missing boolean isTradeRelevant field' };
  }

  return { tradeNote, isTradeRelevant, failureReason: 'success' };
}

async function storeBaseSummary(record: StoredBaseSummary): Promise<DbWriteDebugResult> {
  summaryMemoryCache.set(record.cacheKey, record);

  try {
    await prisma.appSetting.upsert({
      where: { key: summaryStorageKey(record.cacheKey) },
      update: {
        value: {
          projectId: record.projectId,
          sourceHash: record.sourceHash,
          generatedAt: record.generatedAt,
          version: record.version,
          source: record.source,
          summary: record.summary
        }
      },
      create: {
        key: summaryStorageKey(record.cacheKey),
        value: {
          projectId: record.projectId,
          sourceHash: record.sourceHash,
          generatedAt: record.generatedAt,
          version: record.version,
          source: record.source,
          summary: record.summary
        }
      }
    });
    return {
      stored: true,
      errorMessage: '',
      errorName: '',
      errorCode: ''
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : 'PrismaError';
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    console.error('AI BASE SUMMARY STORAGE FAILED:', message);
    return {
      stored: false,
      errorMessage: message,
      errorName: name,
      errorCode: code
    };
  }
}

async function storeTradeNote(record: StoredTradeNote): Promise<boolean> {
  tradeNoteMemoryCache.set(record.cacheKey, record);

  try {
    await prisma.appSetting.upsert({
      where: { key: tradeStorageKey(record.cacheKey) },
      update: {
        value: {
          projectId: record.projectId,
          trade: record.trade,
          sourceHash: record.sourceHash,
          generatedAt: record.generatedAt,
          version: record.version,
          source: record.source,
          tradeNote: record.tradeNote,
          isTradeRelevant: record.isTradeRelevant
        }
      },
      create: {
        key: tradeStorageKey(record.cacheKey),
        value: {
          projectId: record.projectId,
          trade: record.trade,
          sourceHash: record.sourceHash,
          generatedAt: record.generatedAt,
          version: record.version,
          source: record.source,
          tradeNote: record.tradeNote,
          isTradeRelevant: record.isTradeRelevant
        }
      }
    });
    return true;
  } catch (error) {
    console.error('AI TRADE NOTE STORAGE FAILED:', (error as Error).message);
    return false;
  }
}

export function getAiDebugState() {
  return { ...debugState };
}

export function buildBaseSummaryPromptForDebug(input: BaseSummaryInput) {
  return buildBaseSummaryPrompt(input);
}

export async function getStoredBaseSummary(input: BaseSummaryInput): Promise<SummaryLookup> {
  const cacheKey = buildBaseCacheKey(input);
  const hot = summaryMemoryCache.get(cacheKey);

  if (hot) {
    setDebugState({ lastCacheStatus: 'hit' });
    return { cacheKey, cacheStatus: 'hit', summary: hot };
  }

  try {
    const row = await prisma.appSetting.findUnique({ where: { key: summaryStorageKey(cacheKey) } });
    if (!row) {
      setDebugState({ lastCacheStatus: 'miss' });
      return { cacheKey, cacheStatus: 'miss', summary: null };
    }

    const parsed = parseStoredBaseSummary(cacheKey, row.value);
    if (!parsed) {
      setDebugState({ lastCacheStatus: 'miss' });
      return { cacheKey, cacheStatus: 'miss', summary: null };
    }

    summaryMemoryCache.set(cacheKey, parsed);
    setDebugState({ lastCacheStatus: 'hit' });
    return { cacheKey, cacheStatus: 'hit', summary: parsed };
  } catch (error) {
    console.error('AI BASE SUMMARY READ FAILED:', (error as Error).message);
    setDebugState({ lastCacheStatus: 'miss' });
    return { cacheKey, cacheStatus: 'miss', summary: null };
  }
}

export async function getStoredBaseSummaries(inputs: BaseSummaryInput[]): Promise<Map<string, SummaryLookup>> {
  const lookups = new Map<string, SummaryLookup>();
  const misses: Array<{ input: BaseSummaryInput; cacheKey: string }> = [];

  for (const input of inputs) {
    const cacheKey = buildBaseCacheKey(input);
    const hot = summaryMemoryCache.get(cacheKey);
    if (hot) {
      lookups.set(input.projectId, { cacheKey, cacheStatus: 'hit', summary: hot });
      continue;
    }
    misses.push({ input, cacheKey });
  }

  if (misses.length) {
    try {
      const rows = await prisma.appSetting.findMany({
        where: {
          key: {
            in: misses.map((entry) => summaryStorageKey(entry.cacheKey))
          }
        }
      });

      const byKey = new Map(rows.map((row) => [row.key, row.value]));
      for (const miss of misses) {
        const parsed = parseStoredBaseSummary(miss.cacheKey, byKey.get(summaryStorageKey(miss.cacheKey)));
        if (parsed) {
          summaryMemoryCache.set(miss.cacheKey, parsed);
          lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'hit', summary: parsed });
        } else {
          lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'miss', summary: null });
        }
      }
    } catch (error) {
      console.error('AI BASE SUMMARY BATCH READ FAILED:', (error as Error).message);
      for (const miss of misses) {
        lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'miss', summary: null });
      }
    }
  }

  setDebugState({ lastCacheStatus: lookups.size && [...lookups.values()].some((entry) => entry.cacheStatus === 'hit') ? 'hit' : 'miss' });
  return lookups;
}

export async function getStoredTradeNote(input: TradeNoteInput): Promise<TradeNoteLookup> {
  const cacheKey = buildTradeCacheKey(input);
  const hot = tradeNoteMemoryCache.get(cacheKey);

  if (hot) {
    setDebugState({ lastCacheStatus: 'hit' });
    return { cacheKey, cacheStatus: 'hit', tradeNote: hot };
  }

  try {
    const row = await prisma.appSetting.findUnique({ where: { key: tradeStorageKey(cacheKey) } });
    if (!row) {
      setDebugState({ lastCacheStatus: 'miss' });
      return { cacheKey, cacheStatus: 'miss', tradeNote: null };
    }

    const parsed = parseStoredTradeNote(cacheKey, row.value);
    if (!parsed) {
      setDebugState({ lastCacheStatus: 'miss' });
      return { cacheKey, cacheStatus: 'miss', tradeNote: null };
    }

    tradeNoteMemoryCache.set(cacheKey, parsed);
    setDebugState({ lastCacheStatus: 'hit' });
    return { cacheKey, cacheStatus: 'hit', tradeNote: parsed };
  } catch (error) {
    console.error('AI TRADE NOTE READ FAILED:', (error as Error).message);
    setDebugState({ lastCacheStatus: 'miss' });
    return { cacheKey, cacheStatus: 'miss', tradeNote: null };
  }
}

export async function getStoredTradeNotes(inputs: TradeNoteInput[]): Promise<Map<string, TradeNoteLookup>> {
  const lookups = new Map<string, TradeNoteLookup>();
  const misses: Array<{ input: TradeNoteInput; cacheKey: string }> = [];

  for (const input of inputs) {
    const cacheKey = buildTradeCacheKey(input);
    const hot = tradeNoteMemoryCache.get(cacheKey);
    if (hot) {
      lookups.set(input.projectId, { cacheKey, cacheStatus: 'hit', tradeNote: hot });
      continue;
    }
    misses.push({ input, cacheKey });
  }

  if (misses.length) {
    try {
      const rows = await prisma.appSetting.findMany({
        where: {
          key: {
            in: misses.map((entry) => tradeStorageKey(entry.cacheKey))
          }
        }
      });

      const byKey = new Map(rows.map((row) => [row.key, row.value]));
      for (const miss of misses) {
        const parsed = parseStoredTradeNote(miss.cacheKey, byKey.get(tradeStorageKey(miss.cacheKey)));
        if (parsed) {
          tradeNoteMemoryCache.set(miss.cacheKey, parsed);
          lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'hit', tradeNote: parsed });
        } else {
          lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'miss', tradeNote: null });
        }
      }
    } catch (error) {
      console.error('AI TRADE NOTE BATCH READ FAILED:', (error as Error).message);
      for (const miss of misses) {
        lookups.set(miss.input.projectId, { cacheKey: miss.cacheKey, cacheStatus: 'miss', tradeNote: null });
      }
    }
  }

  setDebugState({ lastCacheStatus: lookups.size && [...lookups.values()].some((entry) => entry.cacheStatus === 'hit') ? 'hit' : 'miss' });
  return lookups;
}

export async function generateAndStoreBaseSummary(
  input: BaseSummaryInput,
  options?: { bypassCache?: boolean }
): Promise<BaseSummaryDebugResult> {
  const cacheKey = buildBaseCacheKey(input);
  const { client, apiKeyDetected, clientInitialized } = getOpenAiClient();

  if (!client) {
    const reason = apiKeyDetected ? 'client init failed' : 'missing key';
    console.log(`AI SKIPPED: ${reason}`);
    setDebugState({ lastAiCallAttempted: false, lastAiResultSource: 'fallback', lastAiFailureReason: reason, lastCacheStatus: 'miss' });
    return {
      attempted: false,
      resultSource: 'fallback',
      failureReason: reason,
      rawResponseText: '',
      rawResponseShape: '',
      cacheStatus: 'miss',
      parsedSummary: '',
      stored: false,
      requestDurationMs: 0,
      openaiErrorMessage: reason,
      openaiErrorName: apiKeyDetected ? 'ClientInitFailed' : 'MissingKey',
      openaiStatusCode: null,
      apiKeyDetected,
      clientInitialized
    };
  }

  if (!options?.bypassCache) {
    const cached = await getStoredBaseSummary(input);
    if (cached.summary) {
      console.log('AI CACHE HIT');
      setDebugState({ lastAiCallAttempted: false, lastAiResultSource: 'ai', lastAiFailureReason: 'cache hit', lastCacheStatus: 'hit' });
      return {
        attempted: false,
        resultSource: 'ai',
        failureReason: 'cache hit',
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'hit',
        parsedSummary: cached.summary.summary,
        stored: true,
        requestDurationMs: 0,
        openaiErrorMessage: '',
        openaiErrorName: '',
        openaiStatusCode: null,
        apiKeyDetected,
        clientInitialized
      };
    }
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<BaseSummaryDebugResult>;

  const promise = (async (): Promise<BaseSummaryDebugResult> => {
    const requestStarted = Date.now();
    const payloadPreview = buildBaseSummaryPrompt(input);
    console.log('OPENAI REQUEST START');
    console.log(`OPENAI REQUEST MODEL: ${OPENAI_MODEL}`);
    console.log(`OPENAI REQUEST PAYLOAD PREVIEW: ${payloadPreview.slice(0, 240)}`);
    setDebugState({
      lastAiCallAttempted: true,
      lastAiResultSource: 'fallback',
      lastAiFailureReason: 'in progress',
      lastCacheStatus: options?.bypassCache ? 'refreshing' : 'miss'
    });

    try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: payloadPreview,
        text: {
          format: SUMMARY_JSON_SCHEMA
        }
      });

      console.log('OPENAI REQUEST SUCCESS');
      const { text, shape } = extractResponseText(response);
      console.log(`OPENAI RESPONSE RAW PREVIEW: ${text.slice(0, 240)}`);
      const parsed = parseSimpleSummaryJson(text);

      if (!text) {
        console.log('OPENAI PARSE ERROR: empty output');
        setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: 'empty output', lastCacheStatus: 'miss' });
        return {
          attempted: true,
          resultSource: 'fallback',
          failureReason: 'empty output',
          rawResponseText: text,
          rawResponseShape: shape,
          cacheStatus: 'miss',
          parsedSummary: '',
          stored: false,
          requestDurationMs: Date.now() - requestStarted,
          openaiErrorMessage: 'empty output',
          openaiErrorName: 'EmptyOutput',
          openaiStatusCode: null,
          apiKeyDetected,
          clientInitialized
        };
      }

      if (!parsed.summary) {
        console.log(`OPENAI PARSE ERROR: ${parsed.failureReason}`);
        setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: parsed.failureReason, lastCacheStatus: 'miss' });
        return {
          attempted: true,
          resultSource: 'fallback',
          failureReason: parsed.failureReason,
          rawResponseText: text,
          rawResponseShape: shape,
          cacheStatus: 'miss',
          parsedSummary: '',
          stored: false,
          requestDurationMs: Date.now() - requestStarted,
          openaiErrorMessage: parsed.failureReason,
          openaiErrorName: 'ParseError',
          openaiStatusCode: null,
          apiKeyDetected,
          clientInitialized
        };
      }
      console.log('OPENAI PARSE SUCCESS');

      const record: StoredBaseSummary = {
        projectId: input.projectId,
        sourceHash: buildBaseSourceHash(input),
        cacheKey,
        source: 'ai',
        generatedAt: new Date().toISOString(),
        version: APP_VERSION,
        summary: parsed.summary
      };
      const stored = await storeBaseSummary(record);
      console.log('AI SUCCESS');
      console.log('AI RESULT:', parsed.summary);
      setDebugState({
        lastAiResultSource: 'ai',
        lastAiFailureReason: 'success',
        lastCacheStatus: stored.stored ? options?.bypassCache ? 'refreshed' : 'stored' : 'stored-error'
      });
      return {
        attempted: true,
        resultSource: 'ai',
        failureReason: 'success',
        rawResponseText: text,
        rawResponseShape: shape,
        cacheStatus: stored.stored ? options?.bypassCache ? 'refreshed' : 'stored' : 'stored-error',
        parsedSummary: parsed.summary,
        stored: stored.stored,
        requestDurationMs: Date.now() - requestStarted,
        openaiErrorMessage: '',
        openaiErrorName: '',
        openaiStatusCode: null,
        apiKeyDetected,
        clientInitialized
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'OpenAIError';
      const statusCode =
        typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : null;
      if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('aborted')) {
        console.log('OPENAI REQUEST ERROR: timeout');
        setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: 'timeout', lastCacheStatus: 'miss' });
        return {
          attempted: true,
          resultSource: 'fallback',
          failureReason: 'timeout',
          rawResponseText: '',
          rawResponseShape: '',
          cacheStatus: 'miss',
          parsedSummary: '',
          stored: false,
          requestDurationMs: Date.now() - requestStarted,
          openaiErrorMessage: message,
          openaiErrorName: errorName,
          openaiStatusCode: statusCode,
          apiKeyDetected,
          clientInitialized
        };
      }

      console.log(`OPENAI REQUEST ERROR: ${message}`);
      setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: `request failed: ${message}`, lastCacheStatus: 'miss' });
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: `request failed: ${message}`,
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'miss',
        parsedSummary: '',
        stored: false,
        requestDurationMs: Date.now() - requestStarted,
        openaiErrorMessage: message,
        openaiErrorName: errorName,
        openaiStatusCode: statusCode,
        apiKeyDetected,
        clientInitialized
      };
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
}

export async function requestBaseSummaryTruth(input: BaseSummaryInput): Promise<BaseSummaryDebugResult> {
  const { client, apiKeyDetected, clientInitialized } = getOpenAiClient();
  if (!client) {
    const reason = apiKeyDetected ? 'client init failed' : 'missing key';
    console.log(`AI SKIPPED: ${reason}`);
    return {
      attempted: false,
      resultSource: 'fallback',
      failureReason: reason,
      rawResponseText: '',
      rawResponseShape: '',
      cacheStatus: 'miss',
      parsedSummary: '',
      stored: false,
      requestDurationMs: 0,
      openaiErrorMessage: reason,
      openaiErrorName: apiKeyDetected ? 'ClientInitFailed' : 'MissingKey',
      openaiStatusCode: null,
      apiKeyDetected,
      clientInitialized
    };
  }

  const requestStarted = Date.now();
  const payloadPreview = buildBaseSummaryPrompt(input);
  console.log('OPENAI REQUEST START');
  console.log(`OPENAI REQUEST MODEL: ${OPENAI_MODEL}`);
  console.log(`OPENAI REQUEST PAYLOAD PREVIEW: ${payloadPreview.slice(0, 240)}`);

  try {
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: payloadPreview,
        text: {
          format: SUMMARY_JSON_SCHEMA
        }
      });

    console.log('OPENAI REQUEST SUCCESS');
    const { text, shape } = extractResponseText(response);
    console.log(`OPENAI RESPONSE RAW PREVIEW: ${text.slice(0, 240)}`);
    if (!text) {
      console.log('OPENAI PARSE ERROR: empty output');
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: 'empty output',
        rawResponseText: '',
        rawResponseShape: shape,
        cacheStatus: 'miss',
        parsedSummary: '',
        stored: false,
        requestDurationMs: Date.now() - requestStarted,
        openaiErrorMessage: 'empty output',
        openaiErrorName: 'EmptyOutput',
        openaiStatusCode: null,
        apiKeyDetected,
        clientInitialized
      };
    }

    const parsed = parseSimpleSummaryJson(text);
    if (!parsed.summary) {
      console.log(`OPENAI PARSE ERROR: ${parsed.failureReason}`);
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: parsed.failureReason,
        rawResponseText: text,
        rawResponseShape: shape,
        cacheStatus: 'miss',
        parsedSummary: '',
        stored: false,
        requestDurationMs: Date.now() - requestStarted,
        openaiErrorMessage: parsed.failureReason,
        openaiErrorName: 'ParseError',
        openaiStatusCode: null,
        apiKeyDetected,
        clientInitialized
      };
    }

    console.log('OPENAI PARSE SUCCESS');
    return {
      attempted: true,
      resultSource: 'ai',
      failureReason: 'success',
      rawResponseText: text,
      rawResponseShape: shape,
      cacheStatus: 'miss',
      parsedSummary: parsed.summary,
      stored: false,
      requestDurationMs: Date.now() - requestStarted,
      openaiErrorMessage: '',
      openaiErrorName: '',
      openaiStatusCode: null,
      apiKeyDetected,
      clientInitialized
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'OpenAIError';
    const statusCode =
      typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : null;
    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('aborted')) {
      console.log('OPENAI REQUEST ERROR: timeout');
      return {
        attempted: true,
        resultSource: 'fallback',
        failureReason: 'timeout',
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'miss',
        parsedSummary: '',
        stored: false,
        requestDurationMs: Date.now() - requestStarted,
        openaiErrorMessage: message,
        openaiErrorName: errorName,
        openaiStatusCode: statusCode,
        apiKeyDetected,
        clientInitialized
      };
    }

    console.log(`OPENAI REQUEST ERROR: ${message}`);
    return {
      attempted: true,
      resultSource: 'fallback',
      failureReason: `request failed: ${message}`,
      rawResponseText: '',
      rawResponseShape: '',
      cacheStatus: 'miss',
      parsedSummary: '',
      stored: false,
      requestDurationMs: Date.now() - requestStarted,
      openaiErrorMessage: message,
      openaiErrorName: errorName,
      openaiStatusCode: statusCode,
      apiKeyDetected,
      clientInitialized
    };
  }
}

export async function saveBaseSummaryTruth(input: BaseSummaryInput, summary: string) {
  const info = getBaseSummaryStorageInfo(input);
  const record: StoredBaseSummary = {
    projectId: input.projectId,
    sourceHash: info.sourceHash,
    cacheKey: info.cacheKey,
    source: 'ai',
    generatedAt: new Date().toISOString(),
    version: APP_VERSION,
    summary: normalizeSummaryText(summary)
  };
  const stored = await storeBaseSummary(record);
  let readBack: StoredBaseSummary | null = null;

  try {
    const row = await prisma.appSetting.findUnique({ where: { key: info.storageKey } });
    readBack = parseStoredBaseSummary(info.cacheKey, row?.value);
  } catch (error) {
    console.error('AI BASE SUMMARY TRUTH READ FAILED:', (error as Error).message);
  }

  return {
    stored: stored.stored,
    cacheKey: info.cacheKey,
    storageKey: info.storageKey,
    sourceHash: info.sourceHash,
    readBack,
    errorMessage: stored.errorMessage,
    errorName: stored.errorName,
    errorCode: stored.errorCode
  };
}

export async function generateAndStoreBaseSummaries(
  inputs: BaseSummaryInput[],
  options?: { bypassCache?: boolean; concurrency?: number }
) {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, 5));
  const results: Array<{ id: string; summarySource: InterpretationSource; cacheStatus: string; failureReason: string; stored: boolean }> = new Array(inputs.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < inputs.length) {
      const current = cursor;
      cursor += 1;
      const input = inputs[current];
      const result = await generateAndStoreBaseSummary(input, options);
      results[current] = {
        id: input.projectId,
        summarySource: result.resultSource,
        cacheStatus: result.cacheStatus,
        failureReason: result.failureReason,
        stored: result.stored
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length || 1) }, () => run()));
  return results;
}

export async function generateAndStoreTradeNote(
  input: TradeNoteInput,
  options?: { bypassCache?: boolean }
): Promise<TradeNoteDebugResult> {
  const cacheKey = buildTradeCacheKey(input);
  const { client } = getOpenAiClient();

  if (!client) {
    console.log('AI SKIPPED: missing key');
    setDebugState({ lastAiCallAttempted: false, lastAiResultSource: 'fallback', lastAiFailureReason: 'missing key', lastCacheStatus: 'miss' });
    return { attempted: false, resultSource: 'fallback', failureReason: 'missing key', rawResponseText: '', rawResponseShape: '', cacheStatus: 'miss', parsedTradeNote: '', parsedIsTradeRelevant: null, stored: false };
  }

  if (!options?.bypassCache) {
    const cached = await getStoredTradeNote(input);
    if (cached.tradeNote) {
      console.log('AI CACHE HIT');
      setDebugState({ lastAiCallAttempted: false, lastAiResultSource: 'ai', lastAiFailureReason: 'cache hit', lastCacheStatus: 'hit' });
      return {
        attempted: false,
        resultSource: 'ai',
        failureReason: 'cache hit',
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'hit',
        parsedTradeNote: cached.tradeNote.tradeNote,
        parsedIsTradeRelevant: cached.tradeNote.isTradeRelevant,
        stored: true
      };
    }
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<TradeNoteDebugResult>;

  const promise = (async (): Promise<TradeNoteDebugResult> => {
    console.log('AI CALLED');
    console.log('AI REQUEST START');
    setDebugState({
      lastAiCallAttempted: true,
      lastAiResultSource: 'fallback',
      lastAiFailureReason: 'in progress',
      lastCacheStatus: options?.bypassCache ? 'refreshing' : 'miss'
    });

    try {
      const response = await client.responses.create(
        {
          model: OPENAI_MODEL,
          input: buildTradeNotePrompt(input)
        },
        {
          signal: AbortSignal.timeout(AI_TIMEOUT_MS)
        }
      );

      console.log('AI REQUEST SUCCESS');
      const { text, shape } = extractResponseText(response);
      const parsed = parseTradeNote(text);

      if (parsed.isTradeRelevant === null) {
        console.log('AI PARSE FAILED:', parsed.failureReason);
        setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: parsed.failureReason, lastCacheStatus: 'miss' });
        return { attempted: true, resultSource: 'fallback', failureReason: parsed.failureReason, rawResponseText: text, rawResponseShape: shape, cacheStatus: 'miss', parsedTradeNote: '', parsedIsTradeRelevant: null, stored: false };
      }

      const record: StoredTradeNote = {
        projectId: input.projectId,
        trade: normalizeTrade(input.selectedTrade),
        sourceHash: buildTradeSourceHash(input),
        cacheKey,
        source: 'ai',
        generatedAt: new Date().toISOString(),
        version: APP_VERSION,
        tradeNote: parsed.tradeNote,
        isTradeRelevant: parsed.isTradeRelevant
      };
      const stored = await storeTradeNote(record);
      console.log('AI SUCCESS');
      console.log('AI RESULT:', record);
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
        parsedTradeNote: record.tradeNote,
        parsedIsTradeRelevant: record.isTradeRelevant,
        stored
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('aborted')) {
        console.log('AI SKIPPED: timeout');
        setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: 'timeout', lastCacheStatus: 'miss' });
        return { attempted: true, resultSource: 'fallback', failureReason: 'timeout', rawResponseText: '', rawResponseShape: '', cacheStatus: 'miss', parsedTradeNote: '', parsedIsTradeRelevant: null, stored: false };
      }

      console.log(`AI REQUEST FAILED: ${message}`);
      setDebugState({ lastAiResultSource: 'fallback', lastAiFailureReason: `request failed: ${message}`, lastCacheStatus: 'miss' });
      return { attempted: true, resultSource: 'fallback', failureReason: `request failed: ${message}`, rawResponseText: '', rawResponseShape: '', cacheStatus: 'miss', parsedTradeNote: '', parsedIsTradeRelevant: null, stored: false };
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
}

export function clearAiNarrativeCache(key?: string) {
  if (key) {
    summaryMemoryCache.delete(key);
    tradeNoteMemoryCache.delete(key);
    return;
  }

  summaryMemoryCache.clear();
  tradeNoteMemoryCache.clear();
}
