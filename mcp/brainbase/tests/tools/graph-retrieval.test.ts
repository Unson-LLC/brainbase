import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
function expect(value: any) {
  return {
    toBe: (wanted: unknown) => assert.equal(value, wanted),
    toHaveBeenCalledTimes: (n: number) => assert.equal(value.mock.callCount(), n),
    not: {toHaveBeenCalled: () => assert.equal(value.mock.callCount(), 0)},
    toMatchObject: (wanted: any) => {
      const match = (actual: any, expected: any) => {
        if (expected && typeof expected === 'object') for (const key of Object.keys(expected)) match(actual?.[key], expected[key]);
        else assert.deepEqual(actual, expected);
      };
      match(value, wanted);
    },
  };
}
import { handleGraphRetrievalToolCall } from '../../src/tools/graph-retrieval.js';
const entity = (id: string) => ({id, entity_type: 'decision', project_code: 'p', payload: {statement: id}});
function deps(records: unknown[], status = 200) {
  const fetch = mock.fn(async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    if (status !== 200) return new Response(JSON.stringify({error: 'fixture outage'}), {status});
    if (url.pathname.endsWith('/search')) {
      return new Response(JSON.stringify({
        records: records.map((record, index) => ({...record as object, score: 0.9 - index / 1000})),
        coverage: records.length >= 500 ? 'partial' : 'complete',
        partial_reasons: records.length >= 500 ? ['entity_limit'] : [],
        index: {model: 'fixture-model', ready: 2, pending: 0},
      }));
    }
    return new Response(JSON.stringify({records: url.pathname.endsWith('/edges') ? [] : records}));
  });
  return {apiUrl: 'https://fixture.invalid', tokenManager: {getToken: async () => `x.${Buffer.from(JSON.stringify({projectCodes:['p']})).toString('base64url')}.x`}, fetch: fetch as typeof globalThis.fetch, embed: async (texts: string[]) => texts.map(() => [1,0])};
}
describe('authenticated Graph retrieval', () => {
  it('denies inaccessible projects before any API request', async () => {
    const d = deps([]); const r = await handleGraphRetrievalToolCall('search', {query:'q', project:'other'},d);
    expect(r?.error?.code).toBe('brainbase_project_not_accessible'); expect(d.fetch).not.toHaveBeenCalled();
  });
  it('returns evidence and observed catalog without asserting sufficiency', async () => {
    const d = deps([entity('a')]); const r = await handleGraphRetrievalToolCall('search', {query:'q',types:['decision']},d);
    expect(r).toMatchObject({status:'ok',data:{sufficiency:'needs_model_verification',absence_confirmed:false,relation_catalog_scope:{inspected:true},candidates:[{id:'a',evidence:{statement:'a'}}]}});
    expect(d.fetch).toHaveBeenCalledTimes(3);
  });
  it('keeps API failure distinct from empty results', async () => {
    expect(await handleGraphRetrievalToolCall('search',{query:'q',types:['decision']},deps([],503))).toMatchObject({status:'unavailable',error:{http_status:503}});
    expect(await handleGraphRetrievalToolCall('search',{query:'q',types:['decision']},deps([]))).toMatchObject({status:'ok',data:{sufficiency:'insufficient',absence_confirmed:false}});
  });

  it('uses the server vector search endpoint and never falls back to the injected embedder on failure', async () => {
    const d = deps([], 503);
    d.embed = async () => { throw new Error('local embedding must not run'); };
    const result = await handleGraphRetrievalToolCall('search', {query:'q',types:['decision']}, d);
    expect(result).toMatchObject({status:'unavailable',error:{http_status:503}});
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [input, init] = d.fetch.mock.calls[0].arguments as [string, RequestInit];
    expect(String(input)).toBe('https://fixture.invalid/api/info/graph/search');
    expect(init.method).toBe('POST');
  });
  it('marks the API entity cap partial', async () => {
    const r = await handleGraphRetrievalToolCall('search',{query:'q',types:['decision'],inspect_relations:false},deps(Array.from({length:500},(_,i)=>entity(String(i)))));
    expect(r).toMatchObject({status:'ok',data:{coverage:'partial',partial_reasons:['entity_limit']}});
  });
  it('rejects malformed records and oversized plans', async () => {
    expect(await handleGraphRetrievalToolCall('search',{query:'q',types:['decision']},deps([{}]))).toMatchObject({status:'error',error:{code:'graph_retrieval_response_invalid'}});
    const d=deps([]);
    expect(await handleGraphRetrievalToolCall('search',{query:'q',plan:{seed_ids:Array(11).fill('a'),steps:[]}},d)).toMatchObject({status:'error'});
    expect(d.fetch).not.toHaveBeenCalled();
  });
});
