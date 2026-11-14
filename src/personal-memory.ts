import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { JudgmentHistoryRecord, JudgmentHistorySource } from './judgment-history.js';
import { requestUrl, writeJson } from './local-web-security.js';
import { readPersonalKg } from './ssot.js';
import type { PersonalKgEntry } from './types.js';

/**
 * 「あなたの記憶」 (docs/specs/personal-memory-viewer.md): the owner's own
 * memories read from the local `personal-kg.jsonl`, and the judgments that
 * used each one, found back from the judgment journal's `personal_knowledge`
 * references.  Read only.  A memory body travels in the response body only,
 * never in a URL or a log line.
 */
export const PERSONAL_MEMORY_HTTP_PREFIX = '/api/personal-memory';

export type PersonalMemoryState = 'active' | 'superseded' | 'retracted' | 'unrecorded';

export interface PersonalMemoryItem {
  readonly id: string;
  readonly kind: string | null;
  readonly text: string;
  readonly tags: readonly string[];
  readonly state: PersonalMemoryState;
  readonly supersededBy: string | null;
  readonly origin: {
    readonly organizationLabel: string | null;
    readonly projectLabel: string | null;
    readonly workplace: string | null;
    readonly inferred: boolean;
  };
  readonly occurredAt: string | null;
  readonly updatedAt: string | null;
  readonly recallScope: 'organization' | 'general' | 'unknown';
  readonly history: readonly { readonly state: PersonalMemoryState; readonly at: string; readonly reason: string | null }[];
}

export type PersonalMemoryList =
  | { readonly status: 'ok'; readonly items: readonly PersonalMemoryItem[] }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface PersonalMemoryJudgment {
  readonly decisionId: string;
  readonly title: string | null;
  readonly at: string;
  readonly kind: string | null;
}

export type PersonalMemoryJudgments =
  | { readonly status: 'ok'; readonly items: readonly PersonalMemoryJudgment[]; readonly total: number }
  | { readonly status: 'unavailable'; readonly reason: string };

export type PersonalMemoryJudgmentCounts =
  | { readonly status: 'ok'; readonly counts: Readonly<Record<string, number>> }
  | { readonly status: 'unavailable'; readonly reason: string };

/** The local writer keeps no state, origin organization or recall scope: the spec's fixed values. */
export function personalMemoryFromEntry(entry: PersonalKgEntry): PersonalMemoryItem {
  return {
    id: entry.id,
    kind: entry.type,
    text: entry.text,
    tags: [...entry.tags ?? []],
    state: 'unrecorded',
    supersededBy: null,
    origin: { organizationLabel: '手元', projectLabel: null, workplace: null, inferred: false },
    occurredAt: null,
    updatedAt: entry.updatedAt ?? null,
    recallScope: 'general',
    history: []
  };
}

function newestFirst(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? 1 : -1;
}

/** An empty file is zero memories; a missing or malformed one is unavailable, never zero. */
export async function readLocalPersonalMemories(dataDir: string): Promise<PersonalMemoryList> {
  try {
    await stat(join(dataDir, 'personal-kg.jsonl'));
  } catch {
    return { status: 'unavailable', reason: 'personal_kg_missing' };
  }
  let entries: PersonalKgEntry[];
  try {
    entries = await readPersonalKg(dataDir);
  } catch {
    return { status: 'unavailable', reason: 'personal_kg_invalid' };
  }
  const items = entries.map(personalMemoryFromEntry);
  items.sort((left, right) => newestFirst(left.updatedAt, right.updatedAt));
  return { status: 'ok', items };
}

function personalReferences(record: JudgmentHistoryRecord): Set<string> {
  const refs = new Set<string>();
  for (const reference of record.judgment.selected_references ?? []) {
    if (reference.kind === 'personal_knowledge' && reference.ref) refs.add(reference.ref);
  }
  return refs;
}

export interface PersonalMemoryJudgmentIndex {
  judgmentsUsing(id: string, limit: number): Promise<PersonalMemoryJudgments>;
  counts(): Promise<PersonalMemoryJudgmentCounts>;
}

/**
 * Finds judgments back from their `personal_knowledge` references.  A
 * reference names a memory by its id, so the journal is bound to these
 * memories only when at least one recorded reference is one of their ids.
 * When every reference names a memory kept elsewhere (for example the
 * organization's personal KG), "not used" cannot be told from "used under
 * another id", and the answer is unavailable instead of zero.
 */
export function createPersonalMemoryJudgmentIndex(options: {
  readonly source: JudgmentHistorySource;
  /** The memory ids, or null when the memories cannot be read. */
  readonly memoryIds: () => Promise<readonly string[] | null>;
  /**
   * How long one journal read answers later requests. A large journal takes
   * tens of seconds to scan, and one opened memory asks for its judgments and
   * the list's counts at the same time.
   */
  readonly reuseMs?: number;
  readonly now?: () => number;
}): PersonalMemoryJudgmentIndex {
  type Index = { status: 'ok'; byMemory: Map<string, PersonalMemoryJudgment[]> } | { status: 'unavailable'; reason: string };

  async function build(): Promise<Index> {
    const [snapshot, ids] = await Promise.all([options.source.read(), options.memoryIds()]);
    if (ids === null) return { status: 'unavailable', reason: 'personal_kg_unavailable' };
    if (snapshot.status !== 'available' || !snapshot.records) {
      return { status: 'unavailable', reason: `journal_${snapshot.status === 'partial' ? 'partial' : 'unavailable'}` };
    }
    const known = new Set(ids);
    const byMemory = new Map<string, PersonalMemoryJudgment[]>(ids.map((id) => [id, []]));
    let referenced = 0;
    let bound = 0;
    for (const record of snapshot.records) {
      const refs = personalReferences(record);
      for (const ref of refs) {
        referenced += 1;
        if (!known.has(ref)) continue;
        bound += 1;
        byMemory.get(ref)?.push({ decisionId: record.record_id, title: record.judgment.summary, at: record.recorded_at, kind: null });
      }
    }
    if (referenced > 0 && bound === 0) return { status: 'unavailable', reason: 'reference_source_mismatch' };
    for (const judgments of byMemory.values()) judgments.sort((left, right) => newestFirst(left.at, right.at));
    return { status: 'ok', byMemory };
  }

  const reuseMs = options.reuseMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  let current: { promise: Promise<Index>; startedAt: number } | null = null;
  function shared(): Promise<Index> {
    if (current && now() - current.startedAt < reuseMs) return current.promise;
    const entry = { promise: build(), startedAt: now() };
    current = entry;
    // A failed read, a missing journal and unreadable memories are not reused: the owner may fix them now.
    const forget = () => { if (current === entry) current = null; };
    entry.promise.then((index) => {
      if (index.status === 'unavailable' && (index.reason === 'journal_unavailable' || index.reason === 'personal_kg_unavailable')) forget();
    }, forget);
    return entry.promise;
  }

  return {
    async judgmentsUsing(id, limit) {
      const index = await shared();
      if (index.status !== 'ok') return index;
      const judgments = index.byMemory.get(id) ?? [];
      return { status: 'ok', items: judgments.slice(0, Math.max(0, limit)), total: judgments.length };
    },
    async counts() {
      const index = await shared();
      if (index.status !== 'ok') return index;
      return { status: 'ok', counts: Object.fromEntries([...index.byMemory].map(([id, judgments]) => [id, judgments.length])) };
    }
  };
}

const DEFAULT_JUDGMENT_LIMIT = 5;
const MAX_JUDGMENT_LIMIT = 500;

/**
 * GET routes under `/api/personal-memory`.  `authorize` runs before any read
 * and throws to refuse the request (the local host requires its launch token
 * on these reads, not only on writes).
 */
export function createPersonalMemoryHttpHandler(options: {
  readonly readMemories: () => Promise<PersonalMemoryList>;
  readonly index: PersonalMemoryJudgmentIndex;
  readonly authorize: (request: IncomingMessage) => void;
  readonly basePath?: string;
}): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  const basePath = (options.basePath ?? PERSONAL_MEMORY_HTTP_PREFIX).replace(/\/+$/u, '');
  return async (request, response) => {
    const url = requestUrl(request);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return false;
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use GET' } });
      return true;
    }
    options.authorize(request);
    const unavailable = (result: { reason: string }) => writeJson(response, 503, { status: 'unavailable', reason: result.reason });
    if (url.pathname === basePath) {
      if (url.searchParams.get('view') === 'judgment-counts') {
        const counts = await options.index.counts();
        if (counts.status === 'ok') writeJson(response, 200, counts);
        else unavailable(counts);
        return true;
      }
      const list = await options.readMemories();
      if (list.status === 'ok') writeJson(response, 200, { status: 'ok', items: list.items, next_cursor: null });
      else unavailable(list);
      return true;
    }
    const rest = url.pathname.slice(basePath.length + 1).split('/');
    let id: string;
    try {
      id = decodeURIComponent(rest[0] ?? '');
    } catch {
      writeJson(response, 400, { error: { code: 'invalid_id', message: 'The memory id is not valid' } });
      return true;
    }
    if (!id || rest.length > 2 || (rest.length === 2 && rest[1] !== 'judgments')) {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } });
      return true;
    }
    if (rest.length === 2) {
      const requested = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_JUDGMENT_LIMIT) : DEFAULT_JUDGMENT_LIMIT;
      const judgments = await options.index.judgmentsUsing(id, limit);
      if (judgments.status === 'ok') writeJson(response, 200, judgments);
      else unavailable(judgments);
      return true;
    }
    const list = await options.readMemories();
    if (list.status !== 'ok') {
      unavailable(list);
      return true;
    }
    const item = list.items.find((candidate) => candidate.id === id);
    if (item) writeJson(response, 200, { status: 'ok', item });
    else writeJson(response, 404, { status: 'not_found' });
    return true;
  };
}
