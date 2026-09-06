import {
  normalizePersonalKgApiUrl,
  type PersonalKgStorageMode,
} from './config.js';

export type { PersonalKgStorageMode } from './config.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TokenManagerLike {
  getToken(): Promise<string>;
}

export interface PersonalKnowledgeEvent {
  [key: string]: unknown;
}

export interface PersonalKnowledgeClientOptions {
  mode: PersonalKgStorageMode;
  apiUrl: string;
  tokenManager?: TokenManagerLike;
  getToken?: () => Promise<string>;
  fetch?: FetchLike;
}

export class PersonalKnowledgeClientError extends Error {
  readonly status: number | null;
  readonly responseBody: unknown;

  constructor(message: string, { status = null, responseBody = null }: { status?: number | null; responseBody?: unknown } = {}) {
    super(message);
    this.name = 'PersonalKnowledgeClientError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

function parseResponseBody(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function requiredReceiptString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PersonalKnowledgeClientError(`Personal KG response field ${field} must be a non-empty string.`);
  }
  return value;
}

function assertSearchResult(value: unknown): PersonalKnowledgeEvent[] {
  if (!Array.isArray(value)) {
    throw new PersonalKnowledgeClientError('Personal KG search response schema is invalid.');
  }
  return value.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new PersonalKnowledgeClientError(`Personal KG search result ${index} is invalid.`);
    }
    requiredReceiptString((event as Record<string, unknown>).event_id, `results[${index}].event_id`);
    return event as PersonalKnowledgeEvent;
  });
}

function assertRegisterReceipt(value: unknown): PersonalKnowledgeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersonalKnowledgeClientError('Personal KG register response schema is invalid.');
  }
  const receipt = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(receipt, 'error')) {
    throw new PersonalKnowledgeClientError('Personal KG register response schema is invalid: the response reported an error.', {
      responseBody: value,
    });
  }
  for (const field of ['event_id', 'owner_person_id', 'organization_id', 'body_hash']) {
    requiredReceiptString(receipt[field], field);
  }
  return receipt;
}

function assertEventInput(event: PersonalKnowledgeEvent): void {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('Personal KG event must be an object.');
  }

  const forbidden = [
    'owner_person_id',
    'ownerPersonId',
    'organization_id',
    'organizationId',
    'person_entity_id',
    'company_authority_response',
    'destination',
  ];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(event, field))) {
    throw new Error('Personal KG owner, organization, authority, and destination are authentication-derived.');
  }
  const persistedFields = new Set([
    'event_id',
    'occurred_at',
    'captured_at',
    'source',
    'source_pointer',
    'body_hash',
    'body',
    'parent_episode_id',
    'permission_snapshot',
    'sensitivity',
  ]);
  const unknown = Object.keys(event).filter((field) => !persistedFields.has(field));
  if (unknown.length > 0) {
    throw new Error(`Personal KG event contains unsupported fields: ${unknown.join(', ')}.`);
  }
  if (typeof event.body !== 'string' || !event.body.trim()) {
    throw new Error('Personal KG event body must be a non-empty string.');
  }
  if (typeof event.body_hash !== 'string' || !event.body_hash.trim()) {
    throw new Error('Personal KG event body_hash must be a non-empty string.');
  }
}

function normalizeSearchInput(query: string, limit?: number): { query: string; limit: number } {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Personal KG search query must be a non-empty string.');
  }
  if (query.length > 4000) {
    throw new Error('Personal KG search query must be at most 4000 characters.');
  }
  const resolvedLimit = limit === undefined ? 10 : limit;
  if (!Number.isInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > 50) {
    throw new Error('Personal KG search limit must be an integer between 1 and 50.');
  }
  return { query: query.trim(), limit: resolvedLimit };
}

export class PersonalKnowledgeClient {
  readonly mode: PersonalKgStorageMode;
  readonly apiUrl: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: PersonalKnowledgeClientOptions) {
    if (options.mode !== 'local' && options.mode !== 'managed_cloud') {
      throw new Error('Personal KG storage mode must be local or managed_cloud.');
    }
    this.mode = options.mode;
    this.apiUrl = normalizePersonalKgApiUrl(options.apiUrl, this.mode);
    if (options.getToken) {
      this.getToken = options.getToken;
    } else if (options.tokenManager?.getToken) {
      this.getToken = () => options.tokenManager!.getToken();
    } else {
      throw new Error('Personal KG client requires an authenticated token manager.');
    }
    this.fetchImpl = options.fetch || ((input, init) => fetch(input, init));
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const token = await this.getToken();
    if (!token || typeof token !== 'string') {
      throw new PersonalKnowledgeClientError('Personal KG authentication token is unavailable.');
    }
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const responseBody = parseResponseBody(await response.text());
    if (!response.ok) {
      throw new PersonalKnowledgeClientError(
        `Personal KG API error: ${response.status} ${response.statusText || 'Request failed'}: ${errorMessage(responseBody, 'request failed')}`,
        { status: response.status, responseBody },
      );
    }
    return responseBody;
  }

  async search(query: string, limit?: number): Promise<PersonalKnowledgeEvent[]> {
    const input = normalizeSearchInput(query, limit);
    return assertSearchResult(await this.post('/api/personal-knowledge/search', input));
  }

  async register(event: PersonalKnowledgeEvent): Promise<PersonalKnowledgeEvent> {
    assertEventInput(event);
    const result = await this.post('/api/personal-knowledge/events', event);
    return assertRegisterReceipt(result);
  }
}

export function createPersonalKnowledgeClient(options: PersonalKnowledgeClientOptions): PersonalKnowledgeClient {
  return new PersonalKnowledgeClient(options);
}
