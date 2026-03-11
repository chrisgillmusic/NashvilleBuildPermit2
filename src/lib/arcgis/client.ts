const FEATURE_URL =
  process.env.ARCGIS_FEATURE_URL ||
  'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0/query';

const CHUNK_SIZE = 250;
const MAX_RETRIES = 4;

type ArcgisFeature = {
  attributes: Record<string, unknown>;
};

type ArcgisQueryResponse = {
  objectIds?: number[];
  features?: ArcgisFeature[];
  count?: number;
  exceededTransferLimit?: boolean;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(params: URLSearchParams, attempt = 0): Promise<ArcgisQueryResponse> {
  const url = `${FEATURE_URL}?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`ArcGIS request failed: ${response.status}`);
    }
    await sleep((attempt + 1) * 500);
    return fetchWithRetry(params, attempt + 1);
  }

  const data = (await response.json()) as ArcgisQueryResponse & { error?: { message?: string } };
  if (data.error) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`ArcGIS error: ${data.error.message || 'unknown'}`);
    }
    await sleep((attempt + 1) * 500);
    return fetchWithRetry(params, attempt + 1);
  }

  return data;
}

export async function fetchMetadata(): Promise<unknown> {
  const url = FEATURE_URL.replace('/query', '');
  const response = await fetch(`${url}?f=json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch ArcGIS metadata');
  return response.json();
}

export async function fetchCount(where = '1=1'): Promise<number> {
  const params = new URLSearchParams({
    where,
    returnCountOnly: 'true',
    f: 'json'
  });
  const data = await fetchWithRetry(params);
  return data.count || 0;
}

export async function fetchObjectIds(where = '1=1'): Promise<number[]> {
  const params = new URLSearchParams({
    where,
    returnIdsOnly: 'true',
    returnGeometry: 'false',
    f: 'json'
  });
  const data = await fetchWithRetry(params);
  return data.objectIds || [];
}

export async function fetchFeaturesByObjectIds(objectIds: number[]): Promise<ArcgisFeature[]> {
  if (!objectIds.length) return [];
  const params = new URLSearchParams({
    objectIds: objectIds.join(','),
    outFields: '*',
    returnGeometry: 'false',
    f: 'json'
  });
  const data = await fetchWithRetry(params);
  return data.features || [];
}

export async function fetchFeaturesByOffset(where = '1=1', resultOffset = 0, resultRecordCount = 500): Promise<ArcgisFeature[]> {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'false',
    resultOffset: String(resultOffset),
    resultRecordCount: String(resultRecordCount),
    f: 'json'
  });
  const data = await fetchWithRetry(params);
  return data.features || [];
}

export function chunkObjectIds(objectIds: number[], chunkSize = CHUNK_SIZE): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < objectIds.length; i += chunkSize) {
    chunks.push(objectIds.slice(i, i + chunkSize));
  }
  return chunks;
}

export type { ArcgisFeature };
