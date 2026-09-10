import { getStorageType } from '../indexer/ontology.js';
import { authenticateProject, toolError, type AuthenticatedApiDependencies, type AuthenticatedProjectContext, type ToolResult } from './authenticated-api-tool.js';
import { retrieveGraph, type Embedder, type GraphNode, type GraphEdge, type RetrievalPlan } from '../retrieval/engine.js';

export const DEFAULT_GRAPH_RETRIEVAL_TYPES = ['decision', 'project', 'org', 'app', 'philosophy', 'glossary_term', 'document', 'person', 'brand'];
export type GraphRetrievalDependencies = AuthenticatedApiDependencies & { embed?: Embedder };
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 1000;
class RetrievalError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus?: number) { super(message); }
}
function validate(args: Record<string, unknown>) {
  if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 6000) throw new RetrievalError('graph_retrieval_input_invalid', 'query must contain 1..6000 characters');
  if (args.mode !== undefined && args.mode !== 'semantic') {
    if (args.mode === 'lexical') {
      throw new RetrievalError(
        'graph_retrieval_lexical_disabled',
        'Lexical search mode is disabled; call search without mode for semantic Graph retrieval, or use resolve_entity/get_entity for a known identifier',
      );
    }
    throw new RetrievalError('graph_retrieval_input_invalid', 'mode must be semantic');
  }
  if (args.project !== undefined && !text(args.project)) throw new RetrievalError('graph_retrieval_input_invalid', 'invalid project');
  if (args.top_k !== undefined && (!Number.isInteger(args.top_k) || Number(args.top_k) < 1 || Number(args.top_k) > 100)) throw new RetrievalError('graph_retrieval_input_invalid', 'top_k must be 1..100');
  const types = args.types ?? DEFAULT_GRAPH_RETRIEVAL_TYPES;
  if (!Array.isArray(types) || types.length < 1 || types.length > 10 || !types.every(text) || new Set(types).size !== types.length) throw new RetrievalError('graph_retrieval_input_invalid', 'types must contain 1..10 distinct type names');
  if (args.inspect_relations !== undefined && typeof args.inspect_relations !== 'boolean') throw new RetrievalError('graph_retrieval_input_invalid', 'inspect_relations must be boolean');
  const plan = args.plan;
  if (plan !== undefined) {
    if (!isRecord(plan) || !Array.isArray(plan.seed_ids) || plan.seed_ids.length < 1 || plan.seed_ids.length > 10 || !plan.seed_ids.every(text)
      || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 3
      || !plan.steps.every(s => isRecord(s) && text(s.relation) && ['incoming', 'outgoing'].includes(String(s.direction)) && (s.target_type === undefined || text(s.target_type)))) {
      throw new RetrievalError('graph_retrieval_input_invalid', 'invalid bounded relation plan');
    }
  }
  return { query: args.query, types: types as string[], plan: plan as RetrievalPlan | undefined };
}
function node(row: unknown): GraphNode {
  if (!isRecord(row) || !text(row.id ?? row.entity_id) || !text(row.entity_type) || !isRecord(row.payload)) throw new RetrievalError('graph_retrieval_response_invalid', 'Malformed Graph entity');
  return { ...row, id: String(row.id ?? row.entity_id), entity_type: row.entity_type, payload: row.payload,
    ...(row.project_code === null ? {project_code: undefined} : {}) } as GraphNode;
}
function edge(row: unknown): GraphEdge {
  if (!isRecord(row) || !text(row.from_id) || !text(row.to_id) || !text(row.rel_type)) throw new RetrievalError('graph_retrieval_response_invalid', 'Malformed Graph edge');
  return row as unknown as GraphEdge;
}
async function rows(deps: GraphRetrievalDependencies, ctx: AuthenticatedProjectContext, kind: string, params: Record<string, string>): Promise<unknown[]> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${deps.apiUrl.replace(/\/+$/, '')}/api/info/graph/${kind}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${ctx.token}`, 'x-brainbase-projects': ctx.scope.join(','), accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new RetrievalError('brainbase_api_unavailable', 'Graph request failed or timed out'); }
  if (!response.ok) throw new RetrievalError('graph_retrieval_api_error', `Graph ${kind} returned HTTP ${response.status}`, response.status);
  let data: unknown;
  try { data = await response.json(); } catch { throw new RetrievalError('graph_retrieval_response_invalid', 'Graph returned invalid JSON'); }
  if (!isRecord(data) || !Array.isArray(data.records)) throw new RetrievalError('graph_retrieval_response_invalid', 'Graph records are missing');
  return data.records;
}

type GraphSearchResponse = {
  records: Array<{ node: GraphNode; score: number }>;
  coverage: 'complete' | 'partial';
  partial_reasons: string[];
  index: { model: string; ready: number; pending: number };
};

function finiteScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new RetrievalError('graph_retrieval_response_invalid', `${label} must be a finite number between -1 and 1`);
  }
  return value;
}

async function searchGraph(
  deps: GraphRetrievalDependencies,
  ctx: AuthenticatedProjectContext,
  body: Record<string, unknown>,
): Promise<GraphSearchResponse> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${deps.apiUrl.replace(/\/+$/, '')}/api/info/graph/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'x-brainbase-projects': ctx.scope.join(','),
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new RetrievalError('brainbase_api_unavailable', 'Graph vector search failed or timed out');
  }
  if (!response.ok) throw new RetrievalError('graph_retrieval_api_error', `Graph search returned HTTP ${response.status}`, response.status);

  let data: unknown;
  try { data = await response.json(); } catch { throw new RetrievalError('graph_retrieval_response_invalid', 'Graph search returned invalid JSON'); }
  if (!isRecord(data) || !Array.isArray(data.records)
    || (data.coverage !== 'complete' && data.coverage !== 'partial')
    || !Array.isArray(data.partial_reasons) || !data.partial_reasons.every(reason => typeof reason === 'string')
    || !isRecord(data.index)
    || typeof data.index.model !== 'string'
    || !Number.isInteger(data.index.ready) || Number(data.index.ready) < 0
    || !Number.isInteger(data.index.pending) || Number(data.index.pending) < 0) {
    throw new RetrievalError('graph_retrieval_response_invalid', 'Graph search response is malformed');
  }
  const records = data.records.map((raw, index) => {
    if (!isRecord(raw)) throw new RetrievalError('graph_retrieval_response_invalid', `Graph search record ${index} is malformed`);
    const graphNode = node(raw);
    return { node: graphNode, score: finiteScore(raw.score, `Graph search score ${index}`) };
  });
  return {
    records,
    coverage: data.coverage,
    partial_reasons: data.partial_reasons,
    index: {
      model: data.index.model,
      ready: Number(data.index.ready),
      pending: Number(data.index.pending),
    },
  };
}
const active = (record: GraphNode | GraphEdge) => ![record.lifecycle_status, record.lifecycle_state, record.semantic_state,
  record.payload?.lifecycle_status, record.payload?.lifecycle_state, record.payload?.semantic_state, record.payload?.status]
  .some(v => typeof v === 'string' && ['retired', 'merged', 'inactive', 'superseded'].includes(v.trim().toLowerCase()));

export async function handleGraphRetrievalToolCall(name: string, args: Record<string, unknown>, deps: GraphRetrievalDependencies): Promise<ToolResult | null> {
  if (name !== 'search') return null;
  let scope: string[] = [];
  try {
    const input = validate(args);
    const auth = await authenticateProject({project_code: args.project}, deps);
    if ('status' in auth) return auth;
    scope = auth.scope;
    if (!scope.length) return toolError('error', 'brainbase_project_not_accessible', 'No authorized project scope', scope);
    const project: Record<string, string> = typeof args.project === 'string' ? {project: args.project} : {};
    let requestCount = 0;
    const deadline = Date.now() + 45000;
    const readRows = (kind: string, params: Record<string, string>) => {
      if (++requestCount > 40 || Date.now() > deadline) throw new RetrievalError('graph_retrieval_budget_exceeded', 'Graph request budget exceeded; narrow the plan');
      return rows(deps, auth, kind, params);
    };
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const reasons = new Set<string>();
    const precomputedScores = new Map<string, number | null>();
    let remoteSearch: GraphSearchResponse | null = null;
    const addNodes = (records: unknown[]) => {
      for (const raw of records.slice(0, 500)) {
        const n = node(raw);
        if (n.project_code && !scope.includes(n.project_code)) { reasons.add('inaccessible_node'); continue; }
        nodes.set(n.id, n);
      }
      if (records.length >= 500) reasons.add('entity_limit');
    };
    const hydrate = async (ids: string[]) => {
      if (!ids.length) return;
      addNodes(await readRows('entities', {...project, ids: ids.join(','), limit: '500'}));
      if (ids.some(id => !nodes.has(id))) reasons.add('missing_or_inaccessible_endpoint');
    };
    const addSearchRecords = (response: GraphSearchResponse) => {
      for (const record of response.records) {
        const n = record.node;
        if (n.project_code && !scope.includes(n.project_code)) {
          reasons.add('inaccessible_node');
          continue;
        }
        nodes.set(n.id, n);
        precomputedScores.set(n.id, record.score);
      }
      for (const reason of response.partial_reasons) reasons.add(reason);
      if (response.index.pending) reasons.add('index_pending');
      if (response.index.ready > response.records.length) reasons.add('result_limit');
      if (response.coverage === 'partial' && response.partial_reasons.length === 0) reasons.add('vector_search_partial');
    };
    if (!input.plan) {
      remoteSearch = await searchGraph(deps, auth, {
        query: input.query,
        types: input.types,
        ...(typeof args.project === 'string' ? {project: args.project} : {}),
        ...(args.top_k !== undefined ? {top_k: args.top_k} : {}),
      });
      addSearchRecords(remoteSearch);
    } else {
      await hydrate(input.plan.seed_ids);
      let frontier = input.plan.seed_ids.filter(id => nodes.has(id) && active(nodes.get(id)!));
      for (const step of input.plan.steps) {
        const next = new Set<string>();
        for (const id of frontier) {
          const records = await readRows('edges', {...project, type: step.relation, [step.direction === 'incoming' ? 'to' : 'from']: id});
          if (records.length >= 200) reasons.add('edge_limit');
          for (const raw of records.slice(0, 200)) {
            const e = edge(raw);
            if (!active(e) || e.rel_type !== step.relation || (step.direction === 'incoming' ? e.to_id : e.from_id) !== id) continue;
            if (edges.size >= 600) { reasons.add('traversal_limit'); break; }
            edges.set(e.id ?? `${e.from_id}:${e.rel_type}:${e.to_id}`, e);
            next.add(step.direction === 'incoming' ? e.from_id : e.to_id);
          }
          if (next.size >= 100) { reasons.add('frontier_limit'); break; }
        }
        const ids = [...next].slice(0, 100);
        await hydrate(ids.filter(id => !nodes.has(id)));
        frontier = ids.filter(id => nodes.has(id) && active(nodes.get(id)!) && (!step.target_type || nodes.get(id)!.entity_type === step.target_type));
      }

      // The relation plan determines the eligible final frontier. Ask the
      // Graph API to rank only those IDs so no local corpus embedding or
      // ranking fallback can reintroduce unrelated nodes.
      const preview = await retrieveGraph({
        query: input.query,
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        plan: input.plan,
        top_k: 100,
        coverage: reasons.size ? 'partial' : 'complete',
      });
      const eligibleIds = preview.candidates.map(candidate => candidate.id);
      if (eligibleIds.length > 0) {
        remoteSearch = await searchGraph(deps, auth, {
          query: input.query,
          ids: eligibleIds,
          types: input.types,
          top_k: eligibleIds.length,
          ...(typeof args.project === 'string' ? {project: args.project} : {}),
        });
        addSearchRecords(remoteSearch);
      }
    }
    const data = await retrieveGraph({query: input.query, nodes: [...nodes.values()], edges: [...edges.values()], plan: input.plan,
      ...(remoteSearch ? {precomputedScores} : {}), embed: deps.embed, top_k: args.top_k as number | undefined,
      coverage: reasons.size ? 'partial' : 'complete'});
    if (remoteSearch && data.candidates.some(candidate => candidate.score === null)) reasons.add('score_missing');
    if (data.coverage === 'partial' && reasons.size === 0) reasons.add('result_limit');
    const relationCatalog: {seed_id: string; direction: string; relation: string; observed_count: number}[] = [];
    let catalogPartial = false;
    // A small observed catalog lets the model select real relation names for its next call.
    // Discovery is optional and does not claim that these first three seeds cover the Graph.
    if (!input.plan && args.inspect_relations !== false) {
      for (const candidate of data.candidates.slice(0, 3)) {
        for (const direction of ['incoming', 'outgoing'] as const) {
          const records = await readRows('edges', {...project, [direction === 'incoming' ? 'to' : 'from']: candidate.id});
          if (records.length >= 200) catalogPartial = true;
          const counts = new Map<string, number>();
          for (const raw of records.slice(0, 200)) { const e = edge(raw); if (active(e)) counts.set(e.rel_type, (counts.get(e.rel_type) ?? 0) + 1); }
          for (const [relation, observed_count] of counts) relationCatalog.push({seed_id: candidate.id, direction, relation, observed_count});
        }
      }
    }
    return {status: 'ok', scope: {project_codes: scope}, data: {...data,
      searched_scope: {project_codes: args.project ? [args.project] : scope, types: input.plan ? 'plan_endpoints' : input.types},
      absence_confirmed: false, partial_reasons: [...reasons], relation_catalog: relationCatalog,
      ...(remoteSearch ? {index: remoteSearch.index} : {}),
      relation_catalog_scope: {seed_ids: input.plan ? [] : data.candidates.slice(0, 3).map(c => c.id), truncated: catalogPartial, inspected: !input.plan && args.inspect_relations !== false},
    }};
  } catch (error) {
    if (error instanceof RetrievalError) return toolError(error.httpStatus && error.httpStatus >= 500 || error.code === 'brainbase_api_unavailable' ? 'unavailable' : 'error', error.code, error.message, scope, error.httpStatus);
    return toolError('unavailable', 'graph_retrieval_engine_unavailable', error instanceof Error ? error.message : 'Graph retrieval failed', scope);
  }
}

/** Read a known identity without depending on the lazily populated entity index. */
export async function retrieveGraphEntity(args: Record<string, unknown>, deps: GraphRetrievalDependencies): Promise<ToolResult> {
  let scope: string[] = [];
  try {
    if (!text(args.id) || args.id.includes(',') || !text(args.type) || args.type.includes(',')
      || (args.project !== undefined && !text(args.project))) {
      throw new RetrievalError('graph_retrieval_input_invalid', 'A single entity id and type are required');
    }
    const auth = await authenticateProject({ project_code: args.project }, deps);
    if ('status' in auth) return auth;
    scope = auth.scope;
    if (!scope.length) return toolError('error', 'brainbase_project_not_accessible', 'No authorized project scope', scope);
    const storageType = getStorageType(args.type);
    const records = await rows(deps, auth, 'entities', {
      ids: args.id, type: storageType, limit: '2',
      ...(typeof args.project === 'string' ? { project: args.project } : {}),
    });
    const entities = records.map(node);
    if (entities.some(entity => entity.id !== args.id || entity.entity_type !== storageType) || entities.length > 1) {
      throw new RetrievalError('graph_retrieval_response_invalid', 'Graph exact identity response did not match the requested id and type');
    }
    if (entities.some(entity => entity.project_code && (!scope.includes(entity.project_code)
      || (args.project && entity.project_code !== args.project)))) {
      throw new RetrievalError('brainbase_project_not_accessible', 'Graph entity is outside the authorized project scope');
    }
    return { status: 'ok', scope: { project_codes: scope }, data: { entity: entities[0] ?? null, absence_confirmed: false } };
  } catch (error) {
    if (error instanceof RetrievalError) return toolError(error.httpStatus && error.httpStatus >= 500 || error.code === 'brainbase_api_unavailable' ? 'unavailable' : 'error', error.code, error.message, scope, error.httpStatus);
    return toolError('unavailable', 'graph_retrieval_engine_unavailable', error instanceof Error ? error.message : 'Graph entity retrieval failed', scope);
  }
}
