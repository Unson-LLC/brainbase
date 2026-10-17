/*
 * The local Web host's port for 「あなたの記憶」 (ui/personal-memory.js).
 *
 * Every read carries the launch token: the memory bodies are private, so the
 * host guards these reads as it guards writes.  The list is read whole and
 * filtered here, so the words being searched for never go into a request URL.
 * The local host has a single owner, so `isOwner` is always true.
 */

import { filterPersonalMemories } from './personal-memory.js';

export function createPersonalMemoryHttpPort({
  fetcher,
  token,
  basePath = '/api/personal-memory',
  tokenHeader = 'x-brainbase-review-token',
} = {}) {
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const base = String(basePath).replace(/\/+$/u, '');

  async function read(path) {
    if (!request) return { status: 0, body: null, failure: 'fetch_unavailable' };
    try {
      const response = await request(path, { method: 'GET', headers: token ? { [tokenHeader]: token } : {} });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, ok: response.ok === true, body };
    } catch (error) {
      return { status: 0, body: null, failure: error instanceof Error ? error.message : 'request_failed' };
    }
  }

  function unavailable(result) {
    return {
      status: 'unavailable',
      reason: result.failure ?? result.body?.reason ?? result.body?.error?.code ?? `http_${result.status}`,
    };
  }

  return {
    isOwner: () => true,
    async listMemories(filter = {}) {
      const result = await read(base);
      if (!result.ok || result.body?.status !== 'ok' || !Array.isArray(result.body.items)) return unavailable(result);
      return { status: 'ok', items: filterPersonalMemories(result.body.items, filter), nextCursor: null };
    },
    async readMemory(id) {
      const result = await read(`${base}/${encodeURIComponent(id)}`);
      if (result.status === 404 && result.body?.status === 'not_found') return { status: 'not_found' };
      if (!result.ok || result.body?.status !== 'ok' || !result.body.item) return unavailable(result);
      return { status: 'ok', item: result.body.item };
    },
    async listJudgmentsUsing(id, limit) {
      const result = await read(`${base}/${encodeURIComponent(id)}/judgments?limit=${encodeURIComponent(String(limit))}`);
      if (!result.ok || result.body?.status !== 'ok' || !Array.isArray(result.body.items)) return unavailable(result);
      return { status: 'ok', items: result.body.items, total: result.body.total };
    },
    async countJudgmentsUsing() {
      const result = await read(`${base}?view=judgment-counts`);
      if (!result.ok || result.body?.status !== 'ok' || !result.body.counts) return unavailable(result);
      return { status: 'ok', counts: result.body.counts };
    },
  };
}

export default createPersonalMemoryHttpPort;
